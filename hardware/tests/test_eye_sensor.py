"""Is the eye sensor board right, and does it match the main board's connector?"""

import unittest

from design import eye_board, main_board


class EyeSensorBoard(unittest.TestCase):
    def setUp(self):
        self.d = eye_board()

    def test_infrared_sensor_wiring(self):
        d = self.d
        collector = next(k for k, kind in d.pin_type.items() if k[0] == "U1" and kind == "open_collector")
        emitter = next(k for k, kind in d.pin_type.items() if k[0] == "U1" and kind == "open_emitter")
        self.assertEqual(d.net_of[emitter], "GND")
        self.assertEqual(d.pin("U1", "K"), "GND")
        self.assertNotIn(d.pin("U1", "A"), ("GND", d.net_of[collector]), "the IR LED has its own wire")
        self.assertNotEqual(d.net_of[collector], "GND")

    def test_cue_led_points_the_right_way(self):
        self.assertEqual(self.d.pin("D1", "K"), "GND")
        self.assertNotEqual(self.d.pin("D1", "A"), "GND")

    def test_every_signal_reaches_a_wire_pad(self):
        for net, pins in self.d.nets.items():
            self.assertTrue(any(ref == "J1" for ref, _ in pins), f"{net} has no wire pad")

    def test_wire_pads_match_the_main_board_connectors(self):
        """Pin n of the socket on the main board must be the same signal as pad n here."""
        eye, main = self.d, main_board()
        here = {
            1: eye.pin("D1", "A"),                                         # cue LED anode
            2: "GND",
            3: next(eye.net_of[k] for k, kind in eye.pin_type.items() if kind == "open_collector"),
            4: eye.pin("U1", "A"),                                         # IR LED anode
        }
        for connector, side in (("J2", "L"), ("J3", "R")):
            there = {
                1: main.net_of[next(k for k in main.nets[f"CUE_{side}_A"] if k[0] == connector)],
                2: "GND",
                3: f"EYE_{side}_OUT",
                4: f"IR_{side}_A",
            }
            for pin in (1, 2, 3, 4):
                with self.subTest(connector=connector, pin=pin):
                    self.assertEqual(eye.net_of[("J1", str(pin))], here[pin])
                    self.assertEqual(main.net_of[(connector, str(pin))], there[pin])

    def test_ground_is_not_next_to_nothing(self):
        # Ground sits between the cue LED drive and the sensitive sensor output in the cable
        self.assertEqual(self.d.net_of[("J1", "2")], "GND")


if __name__ == "__main__":
    unittest.main()
