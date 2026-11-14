"""Is the main board's circuit right?

These tests read the schematic and ask the questions an engineer reviewing it would
ask: is every chip powered, will the processor boot, will the battery charge at a safe
current, are the LEDs driven within limits. Pins are looked up by the names in the
parts' symbols, so a wrong pin number in scripts/boards.py shows up here.
"""

import unittest

from design import main_board

SUPPLY = 3.3
ADC_FULL_SCALE = 2.5        # volts the ESP32-C3 can measure at its highest range
GPIO_MAX_MA = 20.0          # what one ESP32-C3 pin should be asked to drive


class Power(unittest.TestCase):
    def setUp(self):
        self.d = main_board()

    def test_every_ground_pin_is_grounded(self):
        for key, name in self.d.pin_name.items():
            if name in ("GND", "V_{SS}", "SHIELD", "RES", "MountPin", "-"):
                self.assertEqual(self.d.net_of[key], "GND", f"{key[0]} pin {key[1]} ({name})")

    def test_every_module_ground_pad_is_grounded(self):
        # Ground pins of the ESP32-C3-MINI-1, from its datasheet
        ground = ["1", "2", "11", "14"] + [str(n) for n in range(36, 54)]
        for pad in self.d.pads("U1"):
            if pad.GetNumber() in ground:
                self.assertEqual(pad.GetNetname(), "GND", f"U1 pad {pad.GetNumber()}")

    def test_every_chip_is_powered_from_the_right_rail(self):
        d = self.d
        self.assertEqual(d.pin("U1", "3V3"), "+3V3")
        self.assertEqual(d.pin("U4", "VDD"), "+3V3")
        self.assertEqual(d.pin("U4", "VDD_IO"), "+3V3")
        self.assertEqual(d.pin("U3", "VOUT"), "+3V3")
        self.assertEqual(d.pin("U3", "VIN"), "VSYS")
        self.assertEqual(d.pin("U2", "V_{DD}"), "VBUS")
        self.assertEqual(d.pin("U2", "V_{BAT}"), "VBAT")
        self.assertEqual(d.pin("U5", "VBUS"), "VBUS")
        self.assertEqual(d.pin("J1", "VBUS"), "VBUS")
        self.assertEqual(d.pin("BT1", "+"), "VBAT")

    def test_regulator_is_always_enabled(self):
        self.assertEqual(self.d.pin("U3", "CE"), self.d.pin("U3", "VIN"))

    def test_regulator_has_input_and_output_capacitors(self):
        d = self.d
        self.assertGreaterEqual(sum(d.farads(c) for c in d.between("C", "VSYS", "GND")), 1e-6)
        self.assertGreaterEqual(sum(d.farads(c) for c in d.between("C", "+3V3", "GND")), 10e-6)

    def test_charger_has_input_and_battery_capacitors(self):
        d = self.d
        self.assertGreaterEqual(sum(d.farads(c) for c in d.between("C", "VBUS", "GND")), 1e-6)
        self.assertGreaterEqual(sum(d.farads(c) for c in d.between("C", "VBAT", "GND")), 1e-6)

    def test_charge_current_suits_a_small_cell(self):
        # MCP73831: charge current in amps = 1000 V / programming resistor
        resistors = self.d.between("R", self.d.pin("U2", "PROG"), "GND")
        self.assertEqual(len(resistors), 1)
        milliamps = 1000.0 / self.d.ohms(resistors[0]) * 1000
        self.assertGreaterEqual(milliamps, 50)
        self.assertLessEqual(milliamps, 150, "too fast for a 100-150 mAh cell")

    def test_usb_and_battery_share_the_load(self):
        """On USB the system runs from USB; unplugged, Q1 connects the battery."""
        d = self.d
        self.assertEqual(d.kind["Q1"], "Q_PMOS_GSD")
        self.assertEqual(d.pin("Q1", "G"), "VBUS")
        self.assertEqual(d.pin("Q1", "S"), "VSYS")
        self.assertEqual(d.pin("Q1", "D"), "VBAT")
        self.assertEqual(d.pin("D1", "A"), "VBUS")
        self.assertEqual(d.pin("D1", "K"), "VSYS")
        pull_downs = d.between("R", "VBUS", "GND")
        self.assertEqual(len(pull_downs), 1, "Q1's gate needs pulling low when USB is unplugged")
        self.assertLessEqual(d.ohms(pull_downs[0]), 100e3)

    def test_battery_reading_stays_inside_the_adc_range(self):
        d = self.d
        top = d.between("R", "VBAT", "VBAT_SENSE")
        bottom = d.between("R", "VBAT_SENSE", "GND")
        self.assertEqual((len(top), len(bottom)), (1, 1))
        r_top, r_bottom = d.ohms(top[0]), d.ohms(bottom[0])
        full_battery = 4.2 * r_bottom / (r_top + r_bottom)
        self.assertLess(full_battery, ADC_FULL_SCALE)
        self.assertGreater(full_battery, 1.0, "divides so far down that resolution is wasted")
        microamps = 4.2 / (r_top + r_bottom) * 1e6
        self.assertLess(microamps, 5, "the divider is always connected, so it must draw very little")
        self.assertTrue(d.between("C", "VBAT_SENSE", "GND"), "a high-value divider needs a capacitor at the ADC pin")

    def test_charge_led_lights_while_charging(self):
        # STAT pulls low while charging, so the LED sits between USB power and STAT
        d = self.d
        stat = d.pin("U2", "STAT")
        leds = [led for led in d.refs("D") if d.kind[led] == "LED" and d.pin(led, "K") == stat]
        self.assertEqual(len(leds), 1)
        resistors = d.between("R", "VBUS", d.pin(leds[0], "A"))
        self.assertEqual(len(resistors), 1)
        milliamps = (5.0 - 1.8) / d.ohms(resistors[0]) * 1000
        self.assertLessEqual(milliamps, 5)


class Processor(unittest.TestCase):
    def setUp(self):
        self.d = main_board()

    def pulls(self, net, to):
        return self.d.between("R", net, to)

    def test_enable_pin_has_pull_up_capacitor_and_reset_button(self):
        d = self.d
        enable = d.pin("U1", "EN")
        self.assertTrue(self.pulls(enable, "+3V3"))
        self.assertTrue(d.between("C", enable, "GND"))
        self.assertTrue(d.between("SW", enable, "GND"))

    def test_strapping_pins_let_the_chip_boot_normally(self):
        """GPIO2 and GPIO8 must be high at reset, GPIO9 must not be held low."""
        d = self.d
        for gpio in ("IO2", "IO8"):
            net = d.pin("U1", gpio)
            self.assertTrue(self.pulls(net, "+3V3"), f"{gpio} needs a pull-up")
            self.assertFalse(self.pulls(net, "GND"), f"{gpio} must not be pulled down")
        boot = d.pin("U1", "IO9")
        self.assertFalse(self.pulls(boot, "GND"))
        self.assertFalse(d.on_net("D", boot), "nothing on GPIO9 may pull it low at reset")
        self.assertTrue(d.on_net("TP", boot), "GPIO9 needs a pad to force the bootloader")

    def test_analog_signals_are_on_pins_the_adc_can_read(self):
        # Only ADC1 works reliably on the ESP32-C3
        for net in ("EYE_L_OUT", "EYE_R_OUT", "VBAT_SENSE"):
            self.assertIn("ADC1", self.d.gpio_function(net), net)

    def test_accelerometer_can_wake_the_chip(self):
        # Only GPIO0-5 can wake the ESP32-C3 from deep sleep
        self.assertLessEqual(self.d.gpio(self.d.pin("U4", "INT1")), 5)

    def test_usb_data_lines_reach_the_right_pins(self):
        d = self.d
        plus, minus = d.pin("J1", "D+"), d.pin("J1", "D-")      # checks both pads of each
        self.assertNotEqual(plus, minus)
        self.assertEqual(d.gpio(plus), 19, "USB D+ is GPIO19 on the ESP32-C3")
        self.assertEqual(d.gpio(minus), 18, "USB D- is GPIO18 on the ESP32-C3")
        protected = {d.pin("U5", "I/O1"), d.pin("U5", "I/O2")}
        self.assertEqual(protected, {plus, minus}, "both data lines pass the ESD protection chip")

    def test_usb_c_asks_the_charger_for_power(self):
        # A USB-C source only switches power on when it sees 5.1k on each CC pin
        d = self.d
        cc1, cc2 = d.pin("J1", "CC1"), d.pin("J1", "CC2")
        self.assertNotEqual(cc1, cc2, "the two CC pins must not be joined")
        for cc in (cc1, cc2):
            resistors = self.pulls(cc, "GND")
            self.assertEqual(len(resistors), 1)
            self.assertEqual(d.ohms(resistors[0]), 5100)

    def test_accelerometer_bus(self):
        d = self.d
        clock, data = d.pin("U4", "SCL"), d.pin("U4", "SDA")
        for net in (clock, data):
            d.gpio(net)     # raises if the line doesn't reach the processor
            resistors = self.pulls(net, "+3V3")
            self.assertEqual(len(resistors), 1, f"{net} needs one pull-up")
            self.assertTrue(1e3 <= d.ohms(resistors[0]) <= 10e3)
        self.assertEqual(d.pin("U4", "CS"), "+3V3", "CS high selects I2C")
        self.assertIn(d.pin("U4", "SDO"), ("+3V3", "GND"), "the address pin must not float")

    def test_status_led_current(self):
        d = self.d
        led = next(l for l in d.refs("D") if d.kind[l] == "LED" and d.pin(l, "K") == "GND")
        resistor = [r for r in d.on_net("R", d.pin(led, "A"))]
        self.assertEqual(len(resistor), 1)
        milliamps = (SUPPLY - 2.0) / d.ohms(resistor[0]) * 1000
        self.assertLessEqual(milliamps, 5)
        self.assertGreaterEqual(milliamps, 0.5, "too dim to see")

    def test_no_net_goes_nowhere(self):
        for net, pins in self.d.nets.items():
            self.assertGreaterEqual(len(pins), 2, f"{net} only reaches {sorted(pins)}")

    def test_only_expected_pins_are_left_unconnected(self):
        allowed = {"NC", "SBU1", "SBU2", "INT2"}
        for key, net in self.d.net_of.items():
            if net is None:
                self.assertIn(self.d.pin_name[key], allowed, f"{key[0]} pin {key[1]} is not connected")


class EyeSensorInterface(unittest.TestCase):
    """The parts on the main board that drive one eye sensor board. `side` is L or R."""

    def setUp(self):
        self.d = main_board()

    def test_sensor_power_switch_is_off_until_the_firmware_turns_it_on(self):
        d = self.d
        self.assertEqual(d.kind["Q2"], "Q_PMOS_GSD")
        self.assertEqual(d.pin("Q2", "S"), "+3V3")
        self.assertEqual(d.pin("Q2", "D"), "VSENS")
        gate = d.pin("Q2", "G")
        self.assertTrue(d.between("R", gate, "+3V3"), "the gate needs a pull-up so the switch starts off")
        d.gpio(gate)

    def test_each_eye_has_the_same_circuit_as_the_qtr_1a(self):
        d = self.d
        for side, connector in (("L", "J2"), ("R", "J3")):
            with self.subTest(eye=side):
                infrared = d.between("R", "VSENS", d.pin(connector, "Pin_4"))
                self.assertEqual(len(infrared), 1)
                milliamps = (SUPPLY - 1.2) / d.ohms(infrared[0]) * 1000
                self.assertTrue(5 <= milliamps <= 20, f"IR LED current {milliamps:.1f} mA")

                output = d.pin(connector, "Pin_3")
                self.assertEqual(output, f"EYE_{side}_OUT")
                pull_ups = d.between("R", "VSENS", output)
                self.assertEqual(len(pull_ups), 1)
                self.assertEqual(d.ohms(pull_ups[0]), 47e3, "same pull-up as the QTR-1A, so readings carry over")
                d.gpio(output)

                self.assertEqual(d.pin(connector, "Pin_2"), "GND")

    def test_cue_leds_stay_within_what_a_pin_can_drive(self):
        d = self.d
        for side, connector in (("L", "J2"), ("R", "J3")):
            with self.subTest(eye=side):
                anode = d.pin(connector, "Pin_1")
                resistors = d.on_net("R", anode)
                self.assertEqual(len(resistors), 1)
                drive = next(n for n in (d.net_of[(resistors[0], "1")], d.net_of[(resistors[0], "2")]) if n != anode)
                d.gpio(drive)
                milliamps = (SUPPLY - 1.8) / d.ohms(resistors[0]) * 1000
                self.assertLessEqual(milliamps, GPIO_MAX_MA)

    def test_the_two_eyes_use_different_processor_pins(self):
        d = self.d
        nets = ["EYE_L_OUT", "EYE_R_OUT", "CUE_L", "CUE_R"]
        self.assertEqual(len({d.gpio(n) for n in nets}), 4)


if __name__ == "__main__":
    unittest.main()
