"""Is the board laid out sensibly?

KiCad's design rule check (run here too) covers spacing and unconnected pads. These
tests add the things it doesn't know about: the antenna needs clear space, connectors
must be reachable at the board edge, capacitors must sit next to the chips they serve,
and the factory has limits on hole and track sizes.
"""

import math
import os
import sys
import tempfile
import unittest

import pcbnew

from design import HARDWARE, eye_board, main_board

sys.path.insert(0, os.path.join(HARDWARE, "scripts"))
from gen_pcb import run_drc  # noqa: E402

# JLCPCB's standard process
MIN_TRACK_MM = 0.127
MIN_DRILL_MM = 0.3
MIN_ANNULAR_RING_MM = 0.13

BOARDS = {"main": main_board, "eye": eye_board}


class DesignRules(unittest.TestCase):
    def test_kicad_design_rule_check_passes(self):
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                board = pcbnew.LoadBoard(os.path.join(load().folder, load().name + ".kicad_pcb"))
                pcbnew.ZONE_FILLER(board).Fill(board.Zones())
                board.BuildConnectivity()
                with tempfile.TemporaryDirectory() as tmp:
                    violations, unconnected = run_drc(board, os.path.join(tmp, "drc.txt"))
                errors = [kind for kind, _, body in violations if "Severity: warning" not in body]
                self.assertEqual(errors, [])
                self.assertEqual(len(unconnected), 0, "something is not connected")

    def test_tracks_and_holes_are_within_factory_limits(self):
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                d = load()
                self.assertGreaterEqual(min(pcbnew.ToMM(t.GetWidth()) for t in d.tracks()), MIN_TRACK_MM)
                for via in d.vias():
                    drill = pcbnew.ToMM(via.GetDrillValue())
                    ring = (pcbnew.ToMM(via.GetWidth()) - drill) / 2
                    self.assertGreaterEqual(drill, MIN_DRILL_MM)
                    self.assertGreaterEqual(ring, MIN_ANNULAR_RING_MM - 1e-6)

    def test_no_via_sits_in_or_against_a_solder_pad(self):
        # Solder runs down a via in a pad and leaves the part badly soldered
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                d = load()
                for via in d.vias():
                    x, y = d.xy(via.GetPosition())
                    radius = pcbnew.ToMM(via.GetWidth()) / 2
                    for footprint in d.board.GetFootprints():
                        for pad in footprint.Pads():
                            if pad.GetAttribute() != pcbnew.PAD_ATTRIB_SMD:
                                continue
                            box = pad.GetBoundingBox()
                            left, top = d.xy(box.GetOrigin())
                            right, bottom = d.xy(box.GetEnd())
                            gap = math.hypot(max(left - x, 0, x - right), max(top - y, 0, y - bottom)) - radius
                            self.assertGreater(gap, 0.1, f"via at ({x:.2f}, {y:.2f}) is too close to "
                                                          f"{footprint.GetReference()} pad {pad.GetNumber()}")

    def test_all_parts_are_on_the_front(self):
        # One-sided assembly is cheaper and keeps the back flat
        for name, load in BOARDS.items():
            for ref, footprint in load().footprints.items():
                self.assertFalse(footprint.IsFlipped(), f"{name} {ref}")

    def test_power_tracks_are_not_hair_thin(self):
        d = main_board()
        for net in ("VBUS", "VBAT", "VSYS", "+3V3"):
            self.assertGreaterEqual(min(pcbnew.ToMM(t.GetWidth()) for t in d.tracks(net)), 0.2, net)


class MainBoardLayout(unittest.TestCase):
    def setUp(self):
        self.d = main_board()

    def antenna_edge(self):
        """The antenna is the 5.4 mm of the module beyond its row of ground pads. The
        module lies on its side with the antenna at the left end of the board."""
        module = self.d.footprints["U1"]
        self.assertEqual(module.GetOrientationDegrees(), 90)
        return self.d.xy(module.GetPosition())[0] - 2.9

    def test_board_size(self):
        self.assertLessEqual(self.d.width, 50.0)
        self.assertLessEqual(self.d.height, 18.0)
        self.assertEqual(self.d.board.GetCopperLayerCount(), 4)

    def test_antenna_is_at_the_board_edge(self):
        self.assertLess(self.antenna_edge() - 5.4, 0.5, "the antenna should reach the end of the board")

    def test_no_copper_under_the_antenna(self):
        d, edge = self.d, self.antenna_edge()
        for track in d.tracks():
            self.assertGreaterEqual(min(d.xy(track.GetStart())[0], d.xy(track.GetEnd())[0]), edge)
        for via in d.vias():
            self.assertGreaterEqual(d.xy(via.GetPosition())[0], edge)
        for zone in d.board.Zones():
            if zone.GetIsRuleArea():
                continue
            fill = zone.GetFilledPolysList(zone.GetLayer())
            if fill.OutlineCount():
                left = d.xy(pcbnew.VECTOR2I(fill.BBox().GetLeft(), 0))[0]
                self.assertGreaterEqual(left, edge - 0.01,
                                        f"ground pour on {d.board.GetLayerName(zone.GetLayer())}")

    def test_no_parts_under_the_antenna(self):
        edge = self.antenna_edge()
        for ref in self.d.footprints:
            if ref != "U1":
                self.assertGreaterEqual(self.d.body(ref)[0], edge, ref)

    def test_parts_stay_inside_the_board(self):
        d = self.d
        for ref in d.footprints:
            if ref in ("J1", "J2", "J3"):      # connectors reach the edge on purpose
                continue
            left, top, right, bottom = d.body(ref)
            self.assertTrue(left >= 0 and top >= 0 and right <= d.width and bottom <= d.height, ref)

    def test_usb_socket_opens_at_the_board_edge(self):
        d = self.d
        socket = d.footprints["J1"]
        self.assertEqual(socket.GetOrientationDegrees(), 90, "the socket should face the right-hand edge")
        # The HRO socket's mouth is 3.65 mm in front of its centre
        mouth = d.xy(socket.GetPosition())[0] + 3.65
        self.assertTrue(0 <= mouth - d.width <= 1.0, "the mouth should be flush with the edge or just past it")

    def test_eye_sockets_open_at_the_bottom_edge(self):
        d = self.d
        for ref in ("J2", "J3"):
            socket = d.footprints[ref]
            self.assertEqual(socket.GetOrientationDegrees(), 0)
            # The JST SH side-entry socket's mouth is 2.575 mm in front of its centre
            mouth = d.xy(socket.GetPosition())[1] + 2.575
            self.assertLessEqual(d.height - mouth, 1.0, f"{ref} is set too far back to plug in")
            for pad in d.pads(ref):
                self.assertLessEqual(d.xy(pad.GetBoundingBox().GetEnd())[1], d.height - 0.25, f"{ref} pad off the board")

    def test_capacitors_sit_next_to_the_pins_they_serve(self):
        d = self.d
        wanted = [("U1", "3V3", 10e-6), ("U1", "3V3", 100e-9), ("U4", "VDD", 100e-9),
                  ("U3", "VIN", 1e-6), ("U3", "VOUT", 10e-6), ("U2", "V_{DD}", 1e-6), ("U2", "V_{BAT}", 1e-6)]
        for chip, pin_name, at_least in wanted:
            with self.subTest(chip=chip, pin=pin_name):
                net = d.pin(chip, pin_name)
                pin = next(k[1] for k, name in d.pin_name.items() if k[0] == chip and name == pin_name)
                caps = [c for c in d.between("C", net, "GND") if d.farads(c) >= at_least * 0.99]
                self.assertTrue(caps, f"no capacitor of that size on {net}")
                nearest = min(d.distance(chip, pin, c, p) for c in caps for p in ("1", "2")
                              if d.net_of[(c, p)] == net)
                self.assertLessEqual(nearest, 5.0, f"nearest capacitor is {nearest:.1f} mm away")

    def test_adc_filter_capacitors_are_near_the_connectors(self):
        d = self.d
        for connector, net in (("J2", "EYE_L_OUT"), ("J3", "EYE_R_OUT")):
            cap = d.between("C", net, "GND")
            self.assertEqual(len(cap), 1)
            pin = next(p for p in ("1", "2") if d.net_of[(cap[0], p)] == net)
            self.assertLessEqual(d.distance(connector, "3", cap[0], pin), 5.0)

    def test_usb_data_pair_is_short_and_matched(self):
        d = self.d
        plus, minus = d.routed_length("USB_DP"), d.routed_length("USB_DM")
        self.assertLess(max(plus, minus), 80, "long for an unshielded USB pair")
        self.assertLess(abs(plus - minus), 15, "the two USB lines differ a lot in length")

    def test_ground_plane_is_solid(self):
        d = self.d
        plane = next(z for z in d.board.Zones() if not z.GetIsRuleArea() and z.GetLayer() == pcbnew.In1_Cu)
        fill = plane.GetFilledPolysList(pcbnew.In1_Cu)
        self.assertEqual(fill.OutlineCount(), 1, "the ground plane is split into separate pieces")
        usable = (d.width - self.antenna_edge()) * d.height
        self.assertGreater(fill.Area() / 1e12 / usable, 0.85)

    def test_every_chip_ground_pin_has_a_short_path_to_the_plane(self):
        """The nearest ground via should be close, or the plane does little good."""
        d = self.d
        ground_vias = [d.xy(v.GetPosition()) for v in d.vias() if v.GetNetname() == "GND"]
        for chip in ("U2", "U3", "U4", "U5"):
            for pad in d.pads(chip):
                if pad.GetNetname() == "GND":
                    nearest = min(math.dist(d.xy(pad.GetPosition()), v) for v in ground_vias)
                    self.assertLessEqual(nearest, 4.0, f"{chip} pad {pad.GetNumber()}: {nearest:.1f} mm")

    def test_battery_pads_are_marked(self):
        pads = self.d.pads("BT1")
        self.assertEqual({p.GetNumber(): p.GetNetname() for p in pads}, {"1": "VBAT", "2": "GND"})
        labels = {t.GetText() for t in self.d.board.GetDrawings() if t.GetClass() == "PCB_TEXT"}
        self.assertTrue({"BAT+", "BAT-"} <= labels)


class EyeBoardLayout(unittest.TestCase):
    def setUp(self):
        self.d = eye_board()

    def test_board_size(self):
        self.assertLessEqual(self.d.width, 8.0)
        self.assertLessEqual(self.d.height, 9.5)

    def test_parts_stay_inside_the_board(self):
        d = self.d
        for ref in d.footprints:
            left, top, right, bottom = d.body(ref)
            self.assertTrue(left >= 0 and top >= 0 and right <= d.width and bottom <= d.height, ref)

    def test_cue_led_is_clear_of_the_sensor(self):
        # Far enough apart that the LED doesn't sit in the sensor's field of view
        self.assertGreaterEqual(math.dist(self.d.xy(self.d.footprints["U1"].GetPosition()),
                                          self.d.xy(self.d.footprints["D1"].GetPosition())), 2.5)

    def test_wire_holes_take_thin_wire(self):
        for pad in self.d.pads("J1"):
            self.assertEqual(pad.GetAttribute(), pcbnew.PAD_ATTRIB_PTH)
            self.assertGreaterEqual(pcbnew.ToMM(pad.GetDrillSize().x), 0.6)


if __name__ == "__main__":
    unittest.main()
