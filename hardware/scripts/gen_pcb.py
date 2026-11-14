"""Builds a board's .kicad_pcb: places the footprints, routes the tracks, pours the
ground planes and checks the result with KiCad's design rule checker.

Run with KiCad's Python:  python3 gen_pcb.py main|sensor [--place-only]
"""

import json
import math
import os
import re
import sys
import uuid

import numpy as np
import pcbnew

from boards import BOARDS
from libs import PRETTY
from router import Router

HERE = os.path.dirname(os.path.abspath(__file__))
KICAD_FOOTPRINTS = os.environ.get("KICAD_FOOTPRINTS", "/usr/share/kicad/footprints")
NAMESPACE = uuid.UUID("6f1d3c1e-2a54-4b7e-9d0c-d7ea4ca7c0de")

# Where the board's top-left corner sits on the drawing sheet
ORIGIN_X, ORIGIN_Y = 100.0, 80.0

# Design rules, chosen to sit inside JLCPCB's standard two-layer process
MIN_CLEARANCE = 0.127       # what the design rule check enforces
ROUTE_CLEARANCE = 0.17      # what the router aims for
SIGNAL_WIDTH = 0.2
POWER_WIDTHS = (0.4, 0.3, 0.2)
VIA_DIAMETER, VIA_DRILL = 0.6, 0.3
EDGE_CLEARANCE = 0.3
ZONE_CLEARANCE = 0.2


def mm(value):
    return pcbnew.FromMM(float(value))


def point(x, y):
    return pcbnew.VECTOR2I(mm(x + ORIGIN_X), mm(y + ORIGIN_Y))


def symbol_uuid(board_name, ref):
    """The schematic generator gives each symbol the same id, which is what ties a
    footprint to its symbol when the board is updated from the schematic."""
    return str(uuid.uuid5(NAMESPACE, f"{board_name}/{ref}"))


def load_footprint(lib_id):
    lib, name = lib_id.split(":")
    path = PRETTY if lib == "DreamCatcher" else os.path.join(KICAD_FOOTPRINTS, lib + ".pretty")
    footprint = pcbnew.FootprintLoad(path, name)
    footprint.SetFPID(pcbnew.LIB_ID(lib, name))
    return footprint


def inside_outline(spec, inset):
    """Returns a function telling which points are at least `inset` inside the
    rounded-rectangle board outline."""
    half_w, half_h = spec.width / 2, spec.height / 2
    radius = spec.corner_radius

    def inside(xs, ys):
        qx = np.abs(xs - half_w) - (half_w - radius)
        qy = np.abs(ys - half_h) - (half_h - radius)
        outside = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - radius
        return outside <= -inset
    return inside


def add_outline(board, spec):
    w, h, r = spec.width, spec.height, spec.corner_radius
    k = r * (1 - math.sqrt(0.5))
    lines = [((r, 0), (w - r, 0)), ((w, r), (w, h - r)), ((w - r, h), (r, h)), ((0, h - r), (0, r))]
    arcs = [((w - r, 0), (w - k, k), (w, r)), ((w, h - r), (w - k, h - k), (w - r, h)),
            ((r, h), (k, h - k), (0, h - r)), ((0, r), (k, k), (r, 0))]
    for start, end in lines:
        shape = pcbnew.PCB_SHAPE(board)
        shape.SetShape(pcbnew.SHAPE_T_SEGMENT)
        shape.SetStart(point(*start))
        shape.SetEnd(point(*end))
        shape.SetLayer(pcbnew.Edge_Cuts)
        shape.SetWidth(mm(0.1))
        board.Add(shape)
    for start, mid, end in arcs:
        shape = pcbnew.PCB_SHAPE(board)
        shape.SetShape(pcbnew.SHAPE_T_ARC)
        shape.SetArcGeometry(point(*start), point(*mid), point(*end))
        shape.SetLayer(pcbnew.Edge_Cuts)
        shape.SetWidth(mm(0.1))
        board.Add(shape)


def add_zone(board, rect, layer, net=None):
    """A ground pour, or with no net an area where no copper is allowed."""
    zone = pcbnew.ZONE(board)
    x1, y1, x2, y2 = rect
    outline = zone.Outline()
    outline.NewOutline()
    for x, y in ((x1, y1), (x2, y1), (x2, y2), (x1, y2)):
        outline.Append(mm(x + ORIGIN_X), mm(y + ORIGIN_Y))
    if net is None:
        zone.SetIsRuleArea(True)
        layers = pcbnew.LSET()
        layers.AddLayer(pcbnew.F_Cu)
        layers.AddLayer(pcbnew.B_Cu)
        zone.SetLayerSet(layers)
        zone.SetDoNotAllowCopperPour(True)
        zone.SetDoNotAllowTracks(True)
        zone.SetDoNotAllowVias(True)
        zone.SetDoNotAllowPads(False)
        zone.SetDoNotAllowFootprints(False)
        zone.SetZoneName("Antenna keepout")
    else:
        zone.SetLayer(layer)
        zone.SetNet(net)
        zone.SetLocalClearance(mm(ZONE_CLEARANCE))
        zone.SetMinThickness(mm(0.2))
        zone.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
        zone.SetThermalReliefGap(mm(0.2))
        zone.SetThermalReliefSpokeWidth(mm(0.25))
        zone.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
    board.Add(zone)
    return zone


def courtyard_overlaps(board):
    boxes = []
    for footprint in board.GetFootprints():
        footprint.BuildCourtyardCaches()
        side = pcbnew.B_CrtYd if footprint.IsFlipped() else pcbnew.F_CrtYd
        box = footprint.GetCourtyard(side).BBox()
        if box.GetWidth() > 0:
            boxes.append((footprint.GetReference(), footprint.IsFlipped(), box))
    found = []
    for i, (ref_a, side_a, a) in enumerate(boxes):
        for ref_b, side_b, b in boxes[i + 1:]:
            if side_a == side_b and a.Intersects(b):
                found.append((ref_a, ref_b))
    return found


def route_layers(spec):
    """The copper layers that carry tracks, front to back."""
    if spec.layers == 4:
        return [pcbnew.F_Cu, pcbnew.In2_Cu, pcbnew.B_Cu]
    return [pcbnew.F_Cu, pcbnew.B_Cu]


def pad_layers(pad, copper):
    return [i for i, cu in enumerate(copper) if pad.IsOnLayer(cu)]


def pad_geometry(pad):
    """(x, y, width, height, angle) in board millimetres."""
    pos = pad.GetPosition()
    x, y = pcbnew.ToMM(pos.x) - ORIGIN_X, pcbnew.ToMM(pos.y) - ORIGIN_Y
    if pad.GetShape() == pcbnew.PAD_SHAPE_CUSTOM:
        box = pad.GetBoundingBox()
        return x, y, pcbnew.ToMM(box.GetWidth()), pcbnew.ToMM(box.GetHeight()), 0.0
    size = pad.GetSize()
    return x, y, pcbnew.ToMM(size.x), pcbnew.ToMM(size.y), pad.GetOrientationDegrees()


def pad_cells(router, pad, copper):
    x, y, w, h, angle = pad_geometry(pad)
    round_pad = pad.GetShape() in (pcbnew.PAD_SHAPE_CIRCLE, pcbnew.PAD_SHAPE_OVAL)
    cells = router.cells_in_rect(x, y, w, h, angle, round_pad)
    return [(layer, iy, ix) for layer in pad_layers(pad, copper) for iy, ix in cells]


def quiet_library_checks(project_path):
    """The footprints differ from the library on purpose (hidden text), so the
    project doesn't report that as a problem."""
    with open(project_path) as f:
        project = json.load(f)
    severities = project["board"]["design_settings"].setdefault("rule_severities", {})
    severities["lib_footprint_issues"] = "ignore"
    severities["lib_footprint_mismatch"] = "ignore"
    with open(project_path, "w") as f:
        json.dump(project, f, indent=2)
        f.write("\n")


def run_drc(board, report_path):
    pcbnew.WriteDRCReport(board, report_path, pcbnew.EDA_UNITS_MILLIMETRES, True)
    text = open(report_path).read()
    sections = re.split(r"\n\*\* ", text)
    violations, unconnected = [], []
    for section in sections:
        entries = re.findall(r"^\[(\w+)\]: (.*)\n((?:    .*\n?)+)", section, re.M)
        if section.startswith("Found") and "unconnected" in section.split("\n")[0]:
            unconnected += entries
        elif section.startswith("Found"):
            # The footprints are deliberately not identical to the library's (hidden text)
            violations += [e for e in entries if not e[0].startswith("lib_footprint")]
    return violations, unconnected


def build(spec, place_only=False):
    out_dir = os.path.normpath(os.path.join(HERE, "..", spec.name))
    os.makedirs(out_dir, exist_ok=True)
    pcb_path = os.path.join(out_dir, spec.name + ".kicad_pcb")
    if os.path.exists(pcb_path):
        os.remove(pcb_path)
    board = pcbnew.NewBoard(pcb_path)
    board.SetCopperLayerCount(spec.layers)
    copper = route_layers(spec)

    settings = board.GetDesignSettings()
    settings.m_MinClearance = mm(MIN_CLEARANCE)
    settings.m_TrackMinWidth = mm(0.15)
    settings.m_ViasMinSize = mm(0.5)
    settings.m_ViasMinAnnularWidth = mm(0.13)
    settings.m_MinThroughDrill = mm(0.3)
    settings.m_HoleClearance = mm(0.2)
    settings.m_HoleToHoleMin = mm(0.25)
    settings.m_CopperEdgeClearance = mm(0.25)
    settings.SetBoardThickness(mm(spec.thickness))
    settings.m_MinResolvedSpokes = 1
    netclass = settings.m_NetSettings.m_DefaultNetClass
    netclass.SetClearance(mm(MIN_CLEARANCE))
    netclass.SetTrackWidth(mm(SIGNAL_WIDTH))
    netclass.SetViaDiameter(mm(VIA_DIAMETER))
    netclass.SetViaDrill(mm(VIA_DRILL))

    title = board.GetTitleBlock()
    title.SetTitle(spec.title)
    title.SetRevision("1")

    nets = {}

    def net(name):
        if name not in nets:
            nets[name] = pcbnew.NETINFO_ITEM(board, name)
            board.Add(nets[name])
        return nets[name]

    # ---- Footprints ----
    for part in spec.parts:
        footprint = load_footprint(part.footprint)
        footprint.SetReference(part.ref)
        footprint.SetValue(part.value)
        footprint.Reference().SetVisible(False)
        footprint.Value().SetVisible(False)
        footprint.SetPosition(point(part.at[0], part.at[1]))
        if part.side == "B":
            footprint.Flip(footprint.GetPosition(), False)
        footprint.SetOrientationDegrees(part.at[2])
        footprint.SetPath(pcbnew.KIID_PATH("/" + symbol_uuid(spec.name, part.ref)))
        if part.lcsc:
            footprint.SetProperty("LCSC", part.lcsc)
        if part.mpn:
            footprint.SetProperty("MPN", part.mpn)
        if not part.assemble:
            footprint.SetAttributes(footprint.GetAttributes() | pcbnew.FP_EXCLUDE_FROM_POS_FILES
                                    | pcbnew.FP_EXCLUDE_FROM_BOM)
        numbers = {pad.GetNumber() for pad in footprint.Pads()}
        missing = set(part.pins) - numbers
        if missing:
            raise SystemExit(f"{part.ref}: footprint {part.footprint} has no pad {sorted(missing)}")
        for pad in footprint.Pads():
            if pad.GetNumber() in part.pins:
                pad.SetNet(net(part.pins[pad.GetNumber()]))
        board.Add(footprint)

    overlaps = courtyard_overlaps(board)
    for a, b in overlaps:
        print(f"  courtyards overlap: {a} and {b}")

    add_outline(board, spec)
    for rect in spec.keepouts:
        add_zone(board, rect, None)
    for text, x, y, size, layer in spec.labels:
        label = pcbnew.PCB_TEXT(board)
        label.SetText(text)
        label.SetPosition(point(x, y))
        label.SetLayer(getattr(pcbnew, layer.replace(".", "_")))
        label.SetTextSize(pcbnew.VECTOR2I(mm(size), mm(size)))
        label.SetTextThickness(mm(size * 0.15))
        if layer.startswith("B."):
            label.SetMirrored(True)
        board.Add(label)

    if place_only:
        pcbnew.SaveBoard(pcb_path, board)
        return 0

    # ---- Routing ----
    codes = {name: i + 1 for i, name in enumerate(sorted(nets))}
    pads_by_net = {}
    for footprint in board.GetFootprints():
        for pad in footprint.Pads():
            if pad.GetNetname():
                pads_by_net.setdefault(pad.GetNetname(), []).append(pad)

    def span(name):
        xs = [pad_geometry(p)[0] for p in pads_by_net[name]]
        ys = [pad_geometry(p)[1] for p in pads_by_net[name]]
        return (max(xs) - min(xs)) + (max(ys) - min(ys))

    def route_all(order):
        # The front is where the pads are, and a long track there walls pads in. It is
        # made expensive, so tracks drop to another layer for anything but a short hop.
        router = Router(spec.width, spec.height, layer_cost=[2.5] + [1.0] * (len(copper) - 1),
                        clearance=ROUTE_CLEARANCE, via_diameter=VIA_DIAMETER, via_cost=20.0)
        router.block_outside(inside_outline(spec, EDGE_CLEARANCE))
        for rect in spec.keepouts:
            router.block_rect(*rect)
        for footprint in board.GetFootprints():
            for pad in footprint.Pads():
                x, y, w, h, angle = pad_geometry(pad)
                if pad.GetAttribute() == pcbnew.PAD_ATTRIB_NPTH:
                    router.add_circle(router.layers, -1, x, y, pcbnew.ToMM(pad.GetDrillSize().x) / 2, grow=0.3)
                    continue
                # A pad with no net still can't be touched by anyone else's copper
                code = codes.get(pad.GetNetname(), -1)
                through = pad.GetAttribute() == pcbnew.PAD_ATTRIB_PTH
                router.add_rect(pad_layers(pad, copper), code, x, y, w, h, angle, is_pad=not through)
                if through:
                    router.no_via |= router._disc(round(x / router.pitch), round(y / router.pitch),
                                                  max(w, h) / 2 + VIA_DIAMETER / 2 + 0.2)
        extra = {}
        for name, width, points in spec.preroutes:
            cells = set()
            for (x1, y1), (x2, y2) in zip(points, points[1:]):
                router.tracks.append((codes[name], 0, x1, y1, x2, y2, width))
                router.add_segment(0, codes[name], x1, y1, x2, y2, width)
                steps = max(int(math.hypot(x2 - x1, y2 - y1) / router.pitch), 1)
                for i in range(steps + 1):
                    x, y = x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps
                    cells.add((0, round(y / router.pitch), round(x / router.pitch)))
            extra.setdefault(name, []).append(sorted(cells))
        for name, x, y in spec.pre_vias:
            router.vias.append((codes[name], x, y))
            router.add_circle(router.layers, codes[name], x, y, router.via_radius)
            router.no_via |= router._disc(round(x / router.pitch), round(y / router.pitch),
                                          VIA_DIAMETER + 0.25)
        failed = []
        for name in order:
            widths = POWER_WIDTHS if name in spec.power_nets else (SIGNAL_WIDTH,)
            terminals = [pad_cells(router, pad, copper) for pad in pads_by_net[name]] + extra.get(name, [])
            if not router.route_net(codes[name], name, terminals, widths):
                failed.append(name)
        return router, failed

    # Nets that fail are moved to the front and everything is routed again
    routable = [n for n in pads_by_net if n != "GND"]
    rest = sorted((n for n in routable if n not in spec.first_nets and n not in spec.power_nets), key=span)
    order = [n for n in spec.first_nets if n in routable] + [n for n in spec.power_nets if n in routable] + rest
    for attempt in range(4):
        router, failed = route_all(order)
        print(f"  routing pass {attempt + 1}: {len(failed)} nets incomplete {failed or ''}", flush=True)
        if not failed:
            break
        order = failed + [n for n in order if n not in failed]

    made = {"tracks": 0, "vias": 0}
    by_code = {code: name for name, code in codes.items()}

    def flush():
        """Adds the router's new tracks and vias to the board."""
        for code, layer, x1, y1, x2, y2, width in router.tracks[made["tracks"]:]:
            track = pcbnew.PCB_TRACK(board)
            track.SetStart(point(x1, y1))
            track.SetEnd(point(x2, y2))
            track.SetWidth(mm(width))
            track.SetLayer(copper[layer])
            track.SetNet(nets[by_code[code]])
            board.Add(track)
        for code, x, y in router.vias[made["vias"]:]:
            via = pcbnew.PCB_VIA(board)
            via.SetPosition(point(x, y))
            via.SetViaType(pcbnew.VIATYPE_THROUGH)
            via.SetLayerPair(pcbnew.F_Cu, pcbnew.B_Cu)
            via.SetWidth(mm(VIA_DIAMETER))
            via.SetDrill(mm(VIA_DRILL))
            via.SetNet(nets[by_code[code]])
            board.Add(via)
        made["tracks"], made["vias"] = len(router.tracks), len(router.vias)

    flush()

    # ---- Ground: a pour on both sides, with a via next to every pad the pour misses ----
    report_path = os.path.join(out_dir, "drc-report.txt")
    violations, unconnected = [], []
    if "GND" in nets:
        pour_layers = [pcbnew.F_Cu, pcbnew.B_Cu] + ([pcbnew.In1_Cu] if spec.layers == 4 else [])
        zones = [add_zone(board, (-1, -1, spec.width + 1, spec.height + 1), layer, nets["GND"])
                 for layer in pour_layers]
        filler = pcbnew.ZONE_FILLER(board)
        pad_lookup = {(fp.GetReference(), pad.GetNumber(), pad.GetPosition().x, pad.GetPosition().y): pad
                      for fp in board.GetFootprints() for pad in fp.Pads()}
        tried = set()
        for attempt in range(8):
            filler.Fill(board.Zones())
            board.BuildConnectivity()
            violations, unconnected = run_drc(board, report_path)
            todo = []
            for _, _, body in unconnected:
                for x, y, number, ref in re.findall(r"@\(([\d.-]+) mm, ([\d.-]+) mm\): (?:PTH pad|Pad) (\S+) \[GND\] of (\S+)", body):
                    key = (ref, number, mm(x), mm(y))
                    if key in pad_lookup and key not in tried:
                        tried.add(key)
                        todo.append((key, pad_lookup[key]))
            if not todo:
                break
            for key, pad in todo:
                if not router.fan_out(codes["GND"], pad_cells(router, pad, copper), SIGNAL_WIDTH):
                    print(f"  no room for a ground via at {key[0]} pad {key[1]}")
            flush()
            print(f"  ground pass {attempt + 1}: added vias for {len(todo)} pads", flush=True)

        # Stitch the two pours together wherever there's room
        _, via_ok = router.passable(codes["GND"], SIGNAL_WIDTH)
        step = int(round(2.5 / router.pitch))
        for iy in range(step // 2, router.ny, step):
            for ix in range(step // 2, router.nx, step):
                x, y = ix * router.pitch, iy * router.pitch
                where = point(x, y)
                if via_ok[iy, ix] and all(z.HitTestFilledArea(z.GetLayer(), where, 0) for z in zones):
                    router.vias.append((codes["GND"], x, y))
                    router.add_circle(router.layers, codes["GND"], x, y, router.via_radius)
                    router.no_via |= router._disc(ix, iy, 2.0)
                    _, via_ok = router.passable(codes["GND"], SIGNAL_WIDTH)
        flush()

        # A patch of pour that reaches ground pads but no via is still cut off from
        # the rest. Give each such patch a via of its own.
        gnd_pads = [pad for fp in board.GetFootprints() for pad in fp.Pads() if pad.GetNetname() == "GND"]
        for attempt in range(4):
            filler.Fill(board.Zones())
            board.BuildConnectivity()
            added = 0
            for zone in zones:
                fill = zone.GetFilledPolysList(zone.GetLayer())
                for i in range(fill.OutlineCount()):
                    if any(code == codes["GND"] and fill.Contains(point(x, y), i) for code, x, y in router.vias):
                        continue
                    box = fill.Outline(i).BBox()
                    _, via_ok = router.passable(codes["GND"], SIGNAL_WIDTH)
                    x1, y1 = pcbnew.ToMM(box.GetLeft()) - ORIGIN_X, pcbnew.ToMM(box.GetTop()) - ORIGIN_Y
                    x2, y2 = pcbnew.ToMM(box.GetRight()) - ORIGIN_X, pcbnew.ToMM(box.GetBottom()) - ORIGIN_Y
                    spots = [(ix * router.pitch, iy * router.pitch)
                             for iy in range(max(int(y1 / router.pitch), 0), min(int(y2 / router.pitch) + 1, router.ny), 2)
                             for ix in range(max(int(x1 / router.pitch), 0), min(int(x2 / router.pitch) + 1, router.nx), 2)
                             if via_ok[iy, ix]]
                    spot = next((s for s in spots if fill.Contains(point(*s), i)), None)
                    if spot:
                        router.vias.append((codes["GND"], *spot))
                        router.add_circle(router.layers, codes["GND"], *spot, router.via_radius)
                        added += 1
                        continue
                    # No room inside the patch: run a track from one of its pads to a via outside
                    for pad in gnd_pads:
                        x, y = pad_geometry(pad)[:2]
                        inside = x1 - 0.3 <= x <= x2 + 0.3 and y1 - 0.3 <= y <= y2 + 0.3
                        if inside and pad.IsOnLayer(zone.GetLayer()) and pad.GetAttribute() == pcbnew.PAD_ATTRIB_SMD:
                            if router.fan_out(codes["GND"], pad_cells(router, pad, copper), SIGNAL_WIDTH):
                                added += 1
                                break
                    else:
                        print(f"  ground: no room to tie in the pour patch at ({x1:.1f}, {y1:.1f})")
            flush()
            if not added:
                break
            print(f"  ground: tied in {added} cut-off patches of pour", flush=True)
        filler.Fill(board.Zones())
        board.BuildConnectivity()

    violations, unconnected = run_drc(board, report_path)
    pcbnew.SaveBoard(pcb_path, board)
    quiet_library_checks(pcb_path.replace(".kicad_pcb", ".kicad_pro"))

    print(f"{spec.name}: {len(router.tracks)} tracks, {len(router.vias)} vias")
    kinds = {"error": {}, "warning": {}}
    for kind, _, body in violations:
        level = "warning" if "Severity: warning" in body else "error"
        kinds[level][kind] = kinds[level].get(kind, 0) + 1
    errors = sum(kinds["error"].values())
    print(f"  DRC: {errors} errors {kinds['error'] or ''}, {sum(kinds['warning'].values())} warnings "
          f"{kinds['warning'] or ''}, {len(unconnected)} unconnected, {len(router.failed)} unrouted")
    return errors + len(unconnected) + len(router.failed)


if __name__ == "__main__":
    which = [a for a in sys.argv[1:] if not a.startswith("--")] or list(BOARDS)
    problems = sum(build(BOARDS[name], "--place-only" in sys.argv) for name in which)
    sys.exit(1 if problems else 0)
