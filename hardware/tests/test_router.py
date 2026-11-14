"""Does the track router obey its own rules?

The router in scripts/router.py draws the tracks, so a mistake there ends up on the
board. These run it on tiny made-up boards where the right answer is obvious.
"""

import contextlib
import io
import math
import os
import sys
import unittest

from design import HARDWARE

sys.path.insert(0, os.path.join(HARDWARE, "scripts"))
from router import Router  # noqa: E402

WIDTH = 0.2


def pad(router, net, x, y, size=0.6):
    router.add_rect((0,), net, x, y, size, size, is_pad=True)
    return [(0, iy, ix) for iy, ix in router.cells_in_rect(x, y, size, size, 0)]


def length(router, net):
    return sum(math.dist((x1, y1), (x2, y2)) for n, _, x1, y1, x2, y2, _ in router.tracks if n == net)


def gap_between(router, net_a, net_b):
    """Smallest centre-to-centre distance between two nets' tracks on the same layer,
    sampled along them."""
    def points(net):
        out = []
        for n, layer, x1, y1, x2, y2, _ in router.tracks:
            if n == net:
                steps = max(int(math.dist((x1, y1), (x2, y2)) / 0.02), 1)
                out += [(layer, x1 + (x2 - x1) * i / steps, y1 + (y2 - y1) * i / steps) for i in range(steps + 1)]
        return out
    return min(math.dist(a[1:], b[1:]) for a in points(net_a) for b in points(net_b) if a[0] == b[0])


class RouterBehaviour(unittest.TestCase):
    def test_connects_two_pads_in_a_straight_line(self):
        router = Router(10, 4, layer_cost=(1.0, 1.0))
        ends = [pad(router, 1, 2, 2), pad(router, 1, 8, 2)]
        self.assertTrue(router.route_net(1, "A", ends, (WIDTH,)))
        self.assertEqual(router.vias, [])
        self.assertAlmostEqual(length(router, 1), 6.0 - 0.6, delta=0.35)

    def test_goes_round_another_nets_pad(self):
        router = Router(10, 6, layer_cost=(1.0, 50.0))
        ends = [pad(router, 1, 2, 3), pad(router, 1, 8, 3)]
        pad(router, 2, 5, 3, size=1.5)
        self.assertTrue(router.route_net(1, "A", ends, (WIDTH,)))
        self.assertEqual(router.vias, [])
        self.assertGreater(length(router, 1), 5.8, "the direct line runs through the other pad")
        for _, _, x1, y1, x2, y2, _ in router.tracks:
            for x, y in ((x1, y1), (x2, y2)):
                outside = max(abs(x - 5) - 0.75, abs(y - 3) - 0.75)
                self.assertGreaterEqual(outside, router.clearance + WIDTH / 2 - 1e-6)

    def test_keeps_its_distance_from_an_earlier_track(self):
        router = Router(10, 6, layer_cost=(1.0, 50.0))
        first = [pad(router, 1, 1, 3), pad(router, 1, 9, 3)]
        second = [pad(router, 2, 1, 4), pad(router, 2, 9, 4)]
        self.assertTrue(router.route_net(1, "A", first, (WIDTH,)))
        self.assertTrue(router.route_net(2, "B", second, (WIDTH,)))
        self.assertGreaterEqual(gap_between(router, 1, 2), WIDTH + router.clearance - 0.03)

    def test_changes_layer_to_cross_a_track(self):
        router = Router(10, 10, layer_cost=(1.0, 1.0))
        wall = [pad(router, 1, 5, 0.8), pad(router, 1, 5, 9.2)]
        self.assertTrue(router.route_net(1, "wall", wall, (WIDTH,)))
        # Close the gaps at both ends so the only way across is another layer
        router.block_rect(4.5, 0, 5.5, 0.5)
        router.block_rect(4.5, 9.5, 5.5, 10)
        across = [pad(router, 2, 2, 5), pad(router, 2, 8, 5)]
        self.assertTrue(router.route_net(2, "across", across, (WIDTH,)))
        self.assertEqual(len(router.vias), 2)
        self.assertTrue(any(layer == 1 for net, layer, *_ in router.tracks if net == 2))

    def test_reports_failure_instead_of_crossing(self):
        router = Router(10, 10, layer_cost=(1.0,))       # one layer: no way across
        wall = [pad(router, 1, 5, 0.8), pad(router, 1, 5, 9.2)]
        self.assertTrue(router.route_net(1, "wall", wall, (WIDTH,)))
        router.block_rect(4.5, 0, 5.5, 0.5)
        router.block_rect(4.5, 9.5, 5.5, 10)
        across = [pad(router, 2, 2, 5), pad(router, 2, 8, 5)]
        with contextlib.redirect_stdout(io.StringIO()):      # it prints which pad it couldn't reach
            self.assertFalse(router.route_net(2, "across", across, (WIDTH,)))
        self.assertEqual(len(router.failed), 1)

    def test_stays_out_of_blocked_areas(self):
        router = Router(10, 6, layer_cost=(1.0,))
        router.block_rect(4, 0, 6, 4)
        ends = [pad(router, 1, 2, 2), pad(router, 1, 8, 2)]
        self.assertTrue(router.route_net(1, "A", ends, (WIDTH,)))
        for _, _, x1, y1, x2, y2, _ in router.tracks:
            for x, y in ((x1, y1), (x2, y2)):
                self.assertFalse(4 <= x <= 6 and y <= 4, "track runs through the blocked area")

    def test_uses_a_narrower_track_where_the_wide_one_does_not_fit(self):
        router = Router(10, 4, layer_cost=(1.0,))
        ends = [pad(router, 1, 2, 2), pad(router, 1, 8, 2)]
        # A 0.7 mm gap between two pads of another net: room for a 0.2 mm track and its
        # clearance on both sides, not for a 0.5 mm one
        router.add_rect((0,), 2, 5, 0.825, 1.0, 1.65, is_pad=True)
        router.add_rect((0,), 2, 5, 3.175, 1.0, 1.65, is_pad=True)
        self.assertTrue(router.route_net(1, "A", ends, (0.5, WIDTH)))
        self.assertIn(WIDTH, {w for *_, w in router.tracks})


if __name__ == "__main__":
    unittest.main()
