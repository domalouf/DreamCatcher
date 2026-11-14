"""Writes the project's own symbol and footprint library into hardware/lib.

Everything else comes from KiCad's standard libraries. The ESP32-C3-MINI-1 footprint
is Espressif's own (github.com/espressif/kicad-libraries, CC-BY-SA 4.0 with the usual
exception for designs that use it), kept in vendor/ because KiCad doesn't ship one.
"""

import os
import shutil

HERE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.normpath(os.path.join(HERE, "..", "lib"))
PRETTY = os.path.join(LIB, "DreamCatcher.pretty")
FONT = "(effects (font (size 1.27 1.27)))"


def box_symbol(name, ref, footprint, datasheet, left, right, stacked=(), unused=()):
    """A rectangle with pins down each side. `left`/`right` are (number, name, type)
    or None for a gap. `stacked` pins hide behind the pin they're listed with:
    (visible number, [hidden numbers]). `unused` are the part's no-connect pins."""
    rows = max(len(left), len(right))
    half_h = (rows + 1) * 2.54 / 2
    half_w = 15.24
    out = [
        f'  (symbol "{name}" (in_bom yes) (on_board yes)',
        f'    (property "Reference" "{ref}" (at {-half_w} {half_h + 1.27} 0) (effects (font (size 1.27 1.27)) (justify left)))',
        f'    (property "Value" "{name}" (at {-half_w} {-half_h - 1.27} 0) (effects (font (size 1.27 1.27)) (justify left)))',
        f'    (property "Footprint" "{footprint}" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))',
        f'    (property "Datasheet" "{datasheet}" (at 0 0 0) (effects (font (size 1.27 1.27)) hide))',
        f'    (symbol "{name}_0_1" (rectangle (start {-half_w} {half_h}) (end {half_w} {-half_h})'
        f' (stroke (width 0.254) (type default)) (fill (type background))))',
        f'    (symbol "{name}_1_1"',
    ]
    positions = {}
    for side, pins in ((-1, left), (1, right)):
        for row, pin in enumerate(pins):
            if pin is None:
                continue
            number, pin_name, kind = pin
            x = side * (half_w + 2.54)
            y = half_h - 2.54 * (row + 1)
            angle = 0 if side < 0 else 180
            positions[number] = (x, y, angle)
            out.append(f'      (pin {kind} line (at {x} {y} {angle}) (length 2.54)'
                       f' (name "{pin_name}" {FONT}) (number "{number}" {FONT}))')
    for visible, hidden in stacked:
        x, y, angle = positions[visible]
        for number in hidden:
            out.append(f'      (pin passive line (at {x} {y} {angle}) (length 2.54) hide'
                       f' (name "~" {FONT}) (number "{number}" {FONT}))')
    for number in unused:
        out.append(f'      (pin no_connect line (at {-half_w} {-half_h} 0) (length 0) hide'
                   f' (name "NC" {FONT}) (number "{number}" {FONT}))')
    out += ["    )", "  )"]
    return "\n".join(out)


def write_symbols():
    esp_gnd = ["2", "11", "14"] + [str(n) for n in range(36, 54)]
    esp_unused = ["4", "7", "9", "10", "15", "17", "24", "25", "28", "29", "32", "33", "34", "35"]
    esp = box_symbol(
        "ESP32-C3-MINI-1", "U", "DreamCatcher:ESP32-C3-MINI-1",
        "https://www.espressif.com/sites/default/files/documentation/esp32-c3-mini-1_datasheet_en.pdf",
        left=[("3", "3V3", "power_in"), None, ("8", "EN", "input"), None,
              ("23", "IO9/BOOT", "bidirectional"), None,
              ("27", "IO19/USB_D+", "bidirectional"), ("26", "IO18/USB_D-", "bidirectional"), None,
              ("31", "IO21/TXD0", "bidirectional"), ("30", "IO20/RXD0", "bidirectional"), None,
              ("1", "GND", "power_in")],
        right=[("12", "IO0/ADC1_CH0", "bidirectional"), ("13", "IO1/ADC1_CH1", "bidirectional"),
               ("5", "IO2/ADC1_CH2", "bidirectional"), ("6", "IO3/ADC1_CH3", "bidirectional"),
               ("18", "IO4/ADC1_CH4", "bidirectional"), ("19", "IO5", "bidirectional"),
               ("20", "IO6", "bidirectional"), ("21", "IO7", "bidirectional"),
               ("22", "IO8", "bidirectional"), ("16", "IO10", "bidirectional")],
        stacked=[("1", esp_gnd)], unused=esp_unused)
    acc = box_symbol(
        "LIS2DH12", "U", "Package_LGA:LGA-12_2x2mm_P0.5mm",
        "https://www.st.com/resource/en/datasheet/lis2dh12.pdf",
        left=[("9", "VDD", "power_in"), ("10", "VDD_IO", "power_in"), None,
              ("2", "CS", "input"), ("3", "SDO/SA0", "input"), None,
              ("5", "RES", "passive"), ("6", "GND", "power_in")],
        right=[("1", "SCL/SPC", "input"), ("4", "SDA/SDI", "bidirectional"), None,
               ("12", "INT1", "output"), ("11", "INT2", "output")],
        stacked=[("6", ["7", "8"])])
    os.makedirs(LIB, exist_ok=True)
    with open(os.path.join(LIB, "DreamCatcher.kicad_sym"), "w") as f:
        f.write("(kicad_symbol_lib (version 20220914) (generator dreamcatcher)\n")
        f.write(esp + "\n" + acc + "\n)\n")


def footprint(name, descr, attr, body):
    return (f'(footprint "{name}" (version 20221018) (generator dreamcatcher)\n'
            f'  (layer "F.Cu")\n  (descr "{descr}")\n  (attr {attr})\n'
            f'  (fp_text reference "REF**" (at 0 -2.6) (layer "F.SilkS") hide\n'
            f'    (effects (font (size 0.8 0.8) (thickness 0.12))))\n'
            f'  (fp_text value "{name}" (at 0 2.8) (layer "F.Fab")\n'
            f'    (effects (font (size 0.8 0.8) (thickness 0.12))))\n'
            f'{body})\n')


def silk_line(x1, y1, x2, y2):
    return (f'  (fp_line (start {x1} {y1}) (end {x2} {y2})'
            f' (stroke (width 0.15) (type solid)) (layer "F.SilkS"))\n')


def write_footprints():
    os.makedirs(PRETTY, exist_ok=True)
    shutil.copy(os.path.join(HERE, "vendor", "ESP32-C3-MINI-1.kicad_mod"), PRETTY)

    # Two pads for the battery leads. Pad 1 is +.
    body = ""
    for number, x in (("1", -1.8), ("2", 1.8)):
        body += (f'  (pad "{number}" smd roundrect (at {x} 0) (size 2.2 3.2)'
                 f' (layers "F.Cu" "F.Paste" "F.Mask") (roundrect_rratio 0.15))\n')
    body += silk_line(-1.8, -2.5, -1.8, -1.9) + silk_line(-2.1, -2.2, -1.5, -2.2)   # +
    body += silk_line(1.5, -2.2, 2.1, -2.2)                                          # -
    body += ('  (fp_rect (start -3.15 -1.85) (end 3.15 1.85)'
             ' (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))\n')
    with open(os.path.join(PRETTY, "BatteryPads_P3.6mm.kicad_mod"), "w") as f:
        f.write(footprint("BatteryPads_P3.6mm", "Solder pads for LiPo leads, pad 1 is +",
                          "smd exclude_from_pos_files exclude_from_bom", body))

    # Four plated holes for the cable to the main board
    body = ""
    for i in range(4):
        x = (i - 1.5) * 1.8
        shape = "rect" if i == 0 else "circle"
        body += (f'  (pad "{i + 1}" thru_hole {shape} (at {x} 0) (size 1.3 1.3) (drill 0.7)'
                 f' (layers "*.Cu" "*.Mask"))\n')
    body += ('  (fp_rect (start -3.6 -0.9) (end 3.6 0.9)'
             ' (stroke (width 0.05) (type solid)) (fill none) (layer "F.CrtYd"))\n')
    with open(os.path.join(PRETTY, "WirePads_1x04_P1.8mm.kicad_mod"), "w") as f:
        f.write(footprint("WirePads_1x04_P1.8mm", "Four plated holes for soldering 28-30 AWG wires",
                          "through_hole exclude_from_pos_files exclude_from_bom", body))


if __name__ == "__main__":
    write_symbols()
    write_footprints()
    print("wrote", LIB)
