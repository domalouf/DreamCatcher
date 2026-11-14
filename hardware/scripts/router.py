"""A small grid router for two-layer boards and four-layer boards with one ground plane.

The board is covered by a fine grid. For every grid cell and layer, `own` records
which net's copper (grown by the clearance) covers it: 0 for none, a net number for
exactly one net, -1 for several nets or something no net may touch. A track for net N
may run through a cell if nothing but N is within half a track width of it.

Connections are found with A* over (cell, layer, heading). The heading is part of the
search state so that bends can be charged for, which keeps tracks straight.

Layers are numbered 0..n-1 from the front; only layers that carry tracks are counted,
so a plane layer is left out. Vias always go through the whole board.
"""

import heapq
import math

import numpy as np

SQRT2 = math.sqrt(2)
DIRS = [(1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1)]
NO_DIR = 8
TURN_COST = {0: 0.0, 1: 0.4, 2: 2.0}   # by 45 degree steps; sharper turns aren't allowed


class Router:
    def __init__(self, width, height, layer_cost=(1.0, 1.5), pitch=0.05, clearance=0.19,
                 via_diameter=0.6, via_cost=40.0):
        self.pitch = pitch
        self.nx = int(round(width / pitch)) + 1
        self.ny = int(round(height / pitch)) + 1
        self.clearance = clearance
        self.via_radius = via_diameter / 2
        self.layer_cost = tuple(layer_cost)
        self.layers = tuple(range(len(layer_cost)))
        self.via_cost = via_cost
        self.own = np.zeros((len(layer_cost), self.ny, self.nx), np.int32)
        self.pads = np.zeros((self.ny, self.nx), bool)    # surface-mount pad copper, either side
        # Which net's pads are close by (same coding as `own`). Running a track right
        # past another net's pad can box that pad in, so those cells cost extra.
        self.near_pad = np.zeros((self.ny, self.nx), np.int32)
        self.crowd_cost = 3.0
        self.no_via = np.zeros((self.ny, self.nx), bool)
        self.tracks = []    # (net, layer, x1, y1, x2, y2, width) in mm
        self.vias = []      # (net, x, y)
        self.failed = []

    # ---- Painting copper into the grid ----

    def _window(self, x1, y1, x2, y2):
        ix1 = max(int(math.floor(x1 / self.pitch)), 0)
        iy1 = max(int(math.floor(y1 / self.pitch)), 0)
        ix2 = min(int(math.ceil(x2 / self.pitch)) + 1, self.nx)
        iy2 = min(int(math.ceil(y2 / self.pitch)) + 1, self.ny)
        ys, xs = np.mgrid[iy1:iy2, ix1:ix2]
        return (slice(iy1, iy2), slice(ix1, ix2)), xs * self.pitch, ys * self.pitch

    def _claim(self, layer, window, mask, net):
        cells = self.own[layer][window]
        if net < 0:
            cells[mask] = -1
            return
        clash = mask & (cells != 0) & (cells != net)
        cells[mask & (cells == 0)] = net
        cells[clash] = -1

    @staticmethod
    def _rect_distance(xs, ys, cx, cy, half_w, half_h, angle):
        cos, sin = math.cos(math.radians(angle)), math.sin(math.radians(angle))
        dx, dy = xs - cx, ys - cy
        local_x = np.abs(dx * cos - dy * sin) - half_w
        local_y = np.abs(dx * sin + dy * cos) - half_h
        return np.hypot(np.maximum(local_x, 0), np.maximum(local_y, 0))

    @staticmethod
    def _segment_distance(xs, ys, x1, y1, x2, y2):
        dx, dy = x2 - x1, y2 - y1
        length2 = dx * dx + dy * dy
        if length2 == 0:
            return np.hypot(xs - x1, ys - y1)
        t = np.clip(((xs - x1) * dx + (ys - y1) * dy) / length2, 0, 1)
        return np.hypot(xs - (x1 + t * dx), ys - (y1 + t * dy))

    def add_rect(self, layers, net, cx, cy, w, h, angle=0.0, grow=None, is_pad=False):
        """Copper rectangle (a pad). `grow` defaults to the clearance."""
        grow = self.clearance if grow is None else grow
        reach = math.hypot(w, h) / 2 + grow + self.pitch
        window, xs, ys = self._window(cx - reach, cy - reach, cx + reach, cy + reach)
        distance = self._rect_distance(xs, ys, cx, cy, w / 2, h / 2, angle)
        for layer in layers:
            self._claim(layer, window, distance <= grow, net)
        if is_pad:
            self.pads[window] |= distance <= 0
            near = self.near_pad[window]
            mask = distance <= 0.4
            clash = mask & (near != 0) & (near != net)
            near[mask & (near == 0)] = net
            near[clash] = -1

    def add_circle(self, layers, net, cx, cy, radius, grow=None):
        grow = self.clearance if grow is None else grow
        reach = radius + grow + self.pitch
        window, xs, ys = self._window(cx - reach, cy - reach, cx + reach, cy + reach)
        mask = np.hypot(xs - cx, ys - cy) <= radius + grow
        for layer in layers:
            self._claim(layer, window, mask, net)

    def add_segment(self, layer, net, x1, y1, x2, y2, width):
        reach = width / 2 + self.clearance + self.pitch
        window, xs, ys = self._window(min(x1, x2) - reach, min(y1, y2) - reach,
                                      max(x1, x2) + reach, max(y1, y2) + reach)
        mask = self._segment_distance(xs, ys, x1, y1, x2, y2) <= width / 2 + self.clearance
        self._claim(layer, window, mask, net)

    def block_outside(self, inside):
        """`inside(xs, ys)` -> bool array of the cells copper may occupy."""
        ys, xs = np.mgrid[0:self.ny, 0:self.nx]
        self.own[:, ~inside(xs * self.pitch, ys * self.pitch)] = -1

    def block_rect(self, x1, y1, x2, y2):
        window, xs, ys = self._window(x1, y1, x2, y2)
        mask = (xs >= x1) & (xs <= x2) & (ys >= y1) & (ys <= y2)
        for layer in self.layers:
            self._claim(layer, window, mask, -1)

    # ---- Where a net may go ----

    def _dilate(self, mask, radius):
        cells = int(math.ceil(radius / self.pitch - 1e-9))
        out = mask.copy()
        for dy in range(-cells, cells + 1):
            reach = int(math.floor(math.sqrt(cells * cells - dy * dy)))
            src = mask[max(dy, 0):self.ny + min(dy, 0)]
            row = src.copy()
            for dx in range(1, reach + 1):
                row[:, dx:] |= src[:, :-dx]
                row[:, :-dx] |= src[:, dx:]
            out[max(-dy, 0):self.ny + min(-dy, 0)] |= row
        return out

    def passable(self, net, width):
        blocked = (self.own != 0) & (self.own != net)
        track_ok = np.stack([~self._dilate(blocked[layer], width / 2) for layer in self.layers])
        via_ok = ~self._dilate(blocked.any(axis=0), self.via_radius)
        via_ok &= ~self._dilate(self.pads, self.via_radius + 0.1)
        via_ok &= ~self.no_via
        self._crowded = ((self.near_pad != 0) & (self.near_pad != net)).ravel().tolist()
        return track_ok, via_ok

    def cells_in_rect(self, cx, cy, w, h, angle):
        reach = math.hypot(w, h) / 2 + self.pitch
        window, xs, ys = self._window(cx - reach, cy - reach, cx + reach, cy + reach)
        inside = self._rect_distance(xs, ys, cx, cy, w / 2, h / 2, angle) <= 1e-9
        iy, ix = np.nonzero(inside)
        return [(int(y) + window[0].start, int(x) + window[1].start) for y, x in zip(iy, ix)]

    # ---- Search ----

    def _search(self, sources, is_target, target_box, track_ok, via_ok, allow_vias=True):
        """sources: [(layer, iy, ix)]. Returns the list of (layer, iy, ix) or None."""
        nx, ny = self.nx, self.ny
        plane = nx * ny
        ok = [track_ok[layer].ravel().tolist() for layer in self.layers]
        via = via_ok.ravel().tolist()
        crowded, crowd_cost = self._crowded, self.crowd_cost
        bx1, by1, bx2, by2 = target_box

        def estimate(ix, iy):
            # Slightly overestimating the distance left makes the search much faster,
            # at the price of paths that can be a little longer than the best one
            dx = max(bx1 - ix, 0, ix - bx2)
            dy = max(by1 - iy, 0, iy - by2)
            return 1.3 * (max(dx, dy) + (SQRT2 - 1) * min(dx, dy))

        best = {}
        came = {}
        heap = []
        for layer, iy, ix in sources:
            if not ok[layer][iy * nx + ix]:
                continue
            state = (layer * plane + iy * nx + ix) * 9 + NO_DIR
            best[state] = 0.0
            heapq.heappush(heap, (estimate(ix, iy), 0.0, state))
        while heap:
            _, cost, state = heapq.heappop(heap)
            if cost > best.get(state, 1e18):
                continue
            node, heading = divmod(state, 9)
            layer, cell = divmod(node, plane)
            iy, ix = divmod(cell, nx)
            if is_target(layer, iy, ix):
                path = [(layer, iy, ix)]
                while state in came:
                    state = came[state]
                    node = state // 9
                    layer, cell = divmod(node, plane)
                    path.append((layer,) + divmod(cell, nx))
                return path[::-1]
            layer_ok = ok[layer]
            scale = self.layer_cost[layer]
            for d, (dx, dy) in enumerate(DIRS):
                jx, jy = ix + dx, iy + dy
                if jx < 0 or jy < 0 or jx >= nx or jy >= ny or not layer_ok[jy * nx + jx]:
                    continue
                if heading == NO_DIR:
                    turn = 0.0
                else:
                    diff = abs(d - heading)
                    diff = min(diff, 8 - diff)
                    if diff > 2:
                        continue
                    turn = TURN_COST[diff]
                new_cost = cost + (SQRT2 if dx and dy else 1.0) * scale + turn
                if crowded[jy * nx + jx]:
                    new_cost += crowd_cost
                new_state = (layer * plane + jy * nx + jx) * 9 + d
                if new_cost < best.get(new_state, 1e18):
                    best[new_state] = new_cost
                    came[new_state] = state
                    heapq.heappush(heap, (new_cost + estimate(jx, jy), new_cost, new_state))
            if allow_vias and via[cell]:
                new_cost = cost + self.via_cost
                for other in self.layers:
                    if other == layer or not ok[other][cell]:
                        continue
                    new_state = (other * plane + cell) * 9 + NO_DIR
                    if new_cost < best.get(new_state, 1e18):
                        best[new_state] = new_cost
                        came[new_state] = state
                        heapq.heappush(heap, (new_cost + estimate(ix, iy), new_cost, new_state))
        return None

    def _commit(self, net, path, width):
        """Turns a cell path into tracks and vias, and paints them into the grid."""
        p = self.pitch
        cells = []
        start = 0
        for i in range(1, len(path) + 1):
            if i == len(path) or path[i][0] != path[start][0]:
                run = path[start:i]
                layer = run[0][0]
                corners = [run[0]]
                for j in range(1, len(run) - 1):
                    before = (run[j][1] - run[j - 1][1], run[j][2] - run[j - 1][2])
                    after = (run[j + 1][1] - run[j][1], run[j + 1][2] - run[j][2])
                    if before != after:
                        corners.append(run[j])
                if len(run) > 1:
                    corners.append(run[-1])
                for a, b in zip(corners, corners[1:]):
                    seg = (net, layer, a[2] * p, a[1] * p, b[2] * p, b[1] * p, width)
                    self.tracks.append(seg)
                    self.add_segment(layer, net, *seg[2:6], width)
                if i < len(path):
                    _, iy, ix = path[i]
                    self.vias.append((net, ix * p, iy * p))
                    self.add_circle(self.layers, net, ix * p, iy * p, self.via_radius)
                    # Other vias need their holes kept apart from this one
                    self.no_via |= self._disc(ix, iy, self.via_radius * 2 + 0.25)
                start = i
            cells.append(path[i - 1])
        return cells

    def _disc(self, ix, iy, radius):
        ys, xs = np.ogrid[0:self.ny, 0:self.nx]
        return np.hypot(xs - ix, ys - iy) * self.pitch <= radius

    # ---- Routing nets ----

    def route_net(self, net, name, terminals, widths):
        """terminals: one list of (layer, iy, ix) cells per pad. Tries each width in
        `widths` for each connection, widest first."""
        if len(terminals) < 2:
            return True
        maps = {w: self.passable(net, w) for w in widths}
        centres = [np.mean([(c[2], c[1]) for c in cells], axis=0) for cells in terminals]
        middle = np.mean(centres, axis=0)
        first = min(range(len(terminals)), key=lambda i: np.hypot(*(centres[i] - middle)))
        tree = list(terminals[first])
        tree_points = [centres[first]]
        remaining = set(range(len(terminals))) - {first}
        complete = True
        while remaining:
            target = min(remaining, key=lambda i: min(np.hypot(*(centres[i] - q)) for q in tree_points))
            wanted = {cell for i in remaining for cell in terminals[i]}
            xs = [c[2] for c in terminals[target]]
            ys = [c[1] for c in terminals[target]]
            box = (min(xs), min(ys), max(xs), max(ys))
            path = None
            for width in widths:
                track_ok, via_ok = maps[width]
                path = self._search(tree, lambda l, y, x: (l, y, x) in wanted, box, track_ok, via_ok)
                if path:
                    break
            if not path:
                track_ok = maps[widths[-1]][0]
                reachable = sum(bool(track_ok[c]) for c in terminals[target])
                print(f"    {name}: can't reach pad {target} ({reachable} of its {len(terminals[target])} cells are open)")
                self.failed.append((name, target))
                remaining.discard(target)
                complete = False
                continue
            had_via = any(a[0] != b[0] for a, b in zip(path, path[1:]))
            tree += self._commit(net, path, width)
            reached = next(i for i in remaining if path[-1] in set(terminals[i]))
            tree += terminals[reached]
            tree_points.append(centres[reached])
            remaining.discard(reached)
            if had_via:
                maps = {w: self.passable(net, w) for w in widths}
        return complete

    def fan_out(self, net, cells, width):
        """Connects a pad to a new via next to it (for nets that live on a plane)."""
        track_ok, via_ok = self.passable(net, width)
        layer = cells[0][0]
        nx = self.nx
        via = via_ok.ravel().tolist()
        path = self._search(cells, lambda l, y, x: via[y * nx + x],
                            (cells[0][2], cells[0][1], cells[0][2], cells[0][1]),
                            track_ok, via_ok, allow_vias=False)
        if not path:
            return False
        _, iy, ix = path[-1]
        other = next(l for l in self.layers if l != layer)
        self._commit(net, path + [(other, iy, ix)], width)
        return True
