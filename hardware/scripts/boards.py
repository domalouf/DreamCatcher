"""The two DreamCatcher boards: parts, nets and placement.

This is the single source the schematic, PCB, BOM and placement files are generated
from. A part's `pins` maps pin number -> net name; pins left out are not connected.
`at` is the footprint position on the board (x mm, y mm, rotation in degrees), with
the origin at the board's top-left corner.
"""

from dataclasses import dataclass, field

FP_R = "Resistor_SMD:R_0402_1005Metric"
FP_C = "Capacitor_SMD:C_0402_1005Metric"
FP_C0603 = "Capacitor_SMD:C_0603_1608Metric"
FP_LED = "LED_SMD:LED_0603_1608Metric"


@dataclass
class Part:
    ref: str
    value: str
    symbol: str
    footprint: str
    pins: dict
    at: tuple
    mpn: str = ""
    lcsc: str = ""
    group: str = ""          # schematic block the part is drawn in
    assemble: bool = True    # False: bare pads, nothing for the factory to place
    side: str = "F"          # "B" puts the footprint on the back of the board


@dataclass
class Board:
    name: str
    title: str
    width: float
    height: float
    corner_radius: float
    parts: list
    thickness: float = 0.8
    layers: int = 2          # 4 adds a ground plane (In1) and a third routing layer (In2)
    # Rectangles (x1, y1, x2, y2) with no copper at all, e.g. under the antenna
    keepouts: list = field(default_factory=list)
    # Silkscreen text: (text, x, y, size, layer)
    labels: list = field(default_factory=list)
    # Nets routed with a wider track
    power_nets: tuple = ()
    # Nets routed before everything else, because their pads are hard to reach
    first_nets: tuple = ()
    # Tracks drawn by hand before the router runs: (net, width, [(x, y), ...]) on the front
    preroutes: tuple = ()
    # Vias placed by hand before the router runs: (net, x, y)
    pre_vias: tuple = ()
    groups: tuple = ()


def R(ref, value, a, b, at, lcsc, group):
    return Part(ref, value, "Device:R", FP_R, {"1": a, "2": b}, at, f"0402 {value} 1%", lcsc, group)


def C(ref, value, a, b, at, lcsc, group, footprint=FP_C):
    size = "0603" if footprint == FP_C0603 else "0402"
    return Part(ref, value, "Device:C", footprint, {"1": a, "2": b}, at, f"{size} {value} X5R/X7R", lcsc, group)


# ---- Main board ------------------------------------------------------------------

ESP_GND = ["1", "2", "11", "14"] + [str(n) for n in range(36, 54)]

MAIN_GROUPS = (
    ("usb", "USB-C, ESD protection"),
    ("power", "Charger, battery, power path, 3.3 V regulator"),
    ("mcu", "ESP32-C3 module, buttons, status LED, debug pads"),
    ("eyes", "Eye sensor connectors and sensor power switch"),
    ("motion", "Accelerometer"),
)

# The accelerometer's pads are 0.5 mm apart, so its tracks have to leave it dead
# straight. The 3.3 V pins on both sides are joined by a track under the chip.
ACC_X, ACC_Y = 29.0, 8.0
ACCEL_ESCAPES = (
    ("+3V3", 0.2, [(ACC_X - 0.762, ACC_Y + 0.25), (ACC_X - 0.762, ACC_Y - 0.25),
                   (ACC_X + 0.762, ACC_Y - 0.25), (ACC_X + 0.762, ACC_Y - 0.75)]),
    ("I2C_SCL", 0.2, [(ACC_X - 0.762, ACC_Y - 0.75), (ACC_X - 1.6, ACC_Y - 0.75)]),
    ("I2C_SDA", 0.2, [(ACC_X - 0.762, ACC_Y + 0.75), (ACC_X - 1.6, ACC_Y + 0.75)]),
    ("ACC_INT1", 0.2, [(ACC_X - 0.25, ACC_Y - 0.762), (ACC_X - 0.25, ACC_Y - 1.6)]),
)

main_parts = [
    # -- MCU --
    Part("U1", "ESP32-C3-MINI-1-N4", "DreamCatcher:ESP32-C3-MINI-1", "DreamCatcher:ESP32-C3-MINI-1",
         {**{n: "GND" for n in ESP_GND},
          "3": "+3V3", "8": "EN",
          "12": "EYE_L_OUT",    # GPIO0 / ADC1_CH0
          "13": "EYE_R_OUT",    # GPIO1 / ADC1_CH1
          "5": "SENS_EN_N",     # GPIO2 (strapping pin, held high at boot by R13)
          "6": "VBAT_SENSE",    # GPIO3 / ADC1_CH3
          "18": "ACC_INT1",     # GPIO4 (can wake the chip from deep sleep)
          "19": "CUE_L",        # GPIO5
          "20": "CUE_R",        # GPIO6
          "21": "LED_STAT",     # GPIO7
          "22": "I2C_SDA",      # GPIO8 (strapping pin, pulled up by the I2C resistor)
          "23": "BOOT",         # GPIO9 (strapping pin, low at reset = download mode)
          "16": "I2C_SCL",      # GPIO10
          "26": "USB_DM",       # GPIO18
          "27": "USB_DP",       # GPIO19
          "30": "UART_RX",      # GPIO20
          "31": "UART_TX"},     # GPIO21
         (8.5, 9.0, 90), "ESP32-C3-MINI-1-N4", "C2838502", "mcu"),
    C("C5", "10uF", "GND", "+3V3", (7.5, 16.95, 0), "C19702", "mcu", FP_C0603),
    C("C6", "100nF", "+3V3", "GND", (10.0, 16.95, 0), "C1525", "mcu"),
    C("C7", "1uF", "EN", "GND", (24.6, 2.3, 90), "C52923", "mcu"),
    R("R6", "10k", "+3V3", "EN", (24.6, 4.6, 0), "C25744", "mcu"),
    Part("SW1", "RESET", "Switch:SW_Push", "Button_Switch_SMD:SW_SPST_B3U-1000P",
         {"1": "EN", "2": "GND"}, (28.6, 2.05, 0), "B3U-1000P", "C231329", "mcu"),
    R("R9", "1k", "LED_STAT", "LED_STAT_A", (18.3, 6.6, 0), "C11702", "mcu"),
    Part("D3", "GREEN", "Device:LED", FP_LED, {"1": "GND", "2": "LED_STAT_A"},
         (20.3, 7.0, 90), "0603 green LED", "C72043", "mcu"),
    Part("TP1", "TX", "Connector:TestPoint", "TestPoint:TestPoint_Pad_D1.0mm",
         {"1": "UART_TX"}, (8.75, 1.1, 0), group="mcu", assemble=False),
    Part("TP2", "RX", "Connector:TestPoint", "TestPoint:TestPoint_Pad_D1.0mm",
         {"1": "UART_RX"}, (10.9, 1.1, 0), group="mcu", assemble=False),
    Part("TP3", "3V3", "Connector:TestPoint", "TestPoint:TestPoint_Pad_D1.0mm",
         {"1": "+3V3"}, (6.6, 1.1, 0), group="mcu", assemble=False),
    # Short these two pads while pressing RESET to force the USB bootloader
    Part("TP4", "BOOT", "Connector:TestPoint", "TestPoint:TestPoint_Pad_D1.0mm",
         {"1": "BOOT"}, (32.3, 1.1, 0), group="mcu", assemble=False),
    Part("TP5", "GND", "Connector:TestPoint", "TestPoint:TestPoint_Pad_D1.0mm",
         {"1": "GND"}, (34.45, 1.1, 0), group="mcu", assemble=False),

    # -- USB --
    Part("J1", "USB-C", "Connector:USB_C_Receptacle_USB2.0_16P",
         "Connector_USB:USB_C_Receptacle_HRO_TYPE-C-31-M-12",
         {"A1": "GND", "A12": "GND", "B1": "GND", "B12": "GND", "S1": "GND",
          "A4": "VBUS", "A9": "VBUS", "B4": "VBUS", "B9": "VBUS",
          "A5": "CC1", "B5": "CC2",
          "A6": "USB_DP", "B6": "USB_DP", "A7": "USB_DM", "B7": "USB_DM"},
         (46.85, 6.0, 90), "TYPE-C-31-M-12", "C165948", "usb"),
    R("R1", "5.1k", "GND", "CC1", (40.6, 7.6, 0), "C25905", "usb"),
    R("R2", "5.1k", "GND", "CC2", (40.6, 4.25, 0), "C25905", "usb"),
    Part("U5", "USBLC6-2SC6", "Power_Protection:USBLC6-2SC6", "Package_TO_SOT_SMD:SOT-23-6",
         {"1": "USB_DP", "6": "USB_DP", "3": "USB_DM", "4": "USB_DM", "2": "GND", "5": "VBUS"},
         (37.5, 6.0, 0), "USBLC6-2SC6", "C7519", "usb"),

    # -- Power --
    C("C1", "4.7uF", "GND", "VBUS", (39.6, 10.3, 0), "C19666", "power", FP_C0603),
    Part("U2", "MCP73831-2-OT", "Battery_Management:MCP73831-2-OT", "Package_TO_SOT_SMD:SOT-23-5",
         {"4": "VBUS", "3": "VBAT", "2": "GND", "5": "CHG_PROG", "1": "CHG_STAT"},
         (38.4, 13.6, 0), "MCP73831T-2ACI/OT", "C424093", "power"),
    R("R3", "10k", "GND", "CHG_PROG", (41.6, 12.9, 90), "C25744", "power"),
    R("R4", "2.2k", "VBUS", "CHG_LED_A", (39.9, 1.9, 0), "C25879", "power"),
    Part("D2", "RED", "Device:LED", FP_LED, {"1": "CHG_STAT", "2": "CHG_LED_A"},
         (37.4, 1.9, 0), "0603 red LED", "C2286", "power"),
    C("C2", "4.7uF", "VBAT", "GND", (38.0, 16.5, 0), "C19666", "power", FP_C0603),
    Part("BT1", "LiPo 3.7V", "Device:Battery_Cell", "DreamCatcher:BatteryPads_P3.6mm",
         {"1": "VBAT", "2": "GND"}, (46.4, 15.2, 0), group="power", assemble=False),
    Part("Q1", "AO3401A", "Device:Q_PMOS_GSD", "Package_TO_SOT_SMD:SOT-23",
         {"1": "VBUS", "2": "VSYS", "3": "VBAT"}, (32.7, 5.9, 0), "AO3401A", "C15127", "power"),
    # Discharges VBUS quickly when the cable is pulled, so Q1 switches to the battery at once
    R("R5", "10k", "GND", "VBUS", (33.4, 3.0, 0), "C25744", "power"),
    Part("D1", "B5819WS", "Device:D_Schottky", "Diode_SMD:D_SOD-323",
         {"1": "VSYS", "2": "VBUS"}, (29.0, 5.0, 0), "B5819WS", "C64886", "power"),
    Part("U3", "XC6220B331MR", "Regulator_Linear:XC6220B331MR", "Package_TO_SOT_SMD:SOT-23-5",
         {"1": "VSYS", "3": "VSYS", "2": "GND", "5": "+3V3"},
         (19.6, 2.2, 180), "XC6220B331MR-G", "C86534", "power"),
    C("C3", "1uF", "VSYS", "GND", (22.6, 2.3, 90), "C52923", "power"),
    C("C4", "10uF", "+3V3", "GND", (19.0, 4.7, 0), "C19702", "power", FP_C0603),
    R("R7", "1M", "VBAT_SENSE", "VBAT", (42.0, 15.5, 0), "C26083", "power"),
    R("R8", "1M", "VBAT_SENSE", "GND", (42.0, 16.8, 0), "C26083", "power"),
    C("C8", "100nF", "VBAT_SENSE", "GND", (40.3, 16.5, 90), "C1525", "power"),

    # -- Eye sensors. The four parts above each connector line up with its pins. --
    Part("J2", "EYE L", "Connector_Generic_MountingPin:Conn_01x04_MountingPin",
         "Connector_JST:JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal",
         {"1": "CUE_L_A", "2": "GND", "3": "EYE_L_OUT", "4": "IR_L_A", "MP": "GND"},
         (21.1, 14.9, 0), "SM04B-SRSS-TB", "C160404", "eyes"),
    R("R18", "100", "CUE_L_A", "CUE_L", (19.6, 10.6, 90), "C25076", "eyes"),
    C("C10", "1nF", "GND", "EYE_L_OUT", (20.6, 10.6, 90), "C1523", "eyes"),
    R("R16", "47k", "EYE_L_OUT", "VSENS", (21.6, 10.6, 90), "C25792", "eyes"),
    R("R14", "220", "IR_L_A", "VSENS", (22.6, 10.6, 90), "C25091", "eyes"),
    Part("J3", "EYE R", "Connector_Generic_MountingPin:Conn_01x04_MountingPin",
         "Connector_JST:JST_SH_SM04B-SRSS-TB_1x04-1MP_P1.00mm_Horizontal",
         {"1": "CUE_R_A", "2": "GND", "3": "EYE_R_OUT", "4": "IR_R_A", "MP": "GND"},
         (31.1, 14.9, 0), "SM04B-SRSS-TB", "C160404", "eyes"),
    R("R19", "100", "CUE_R_A", "CUE_R", (29.6, 10.6, 90), "C25076", "eyes"),
    C("C11", "1nF", "GND", "EYE_R_OUT", (30.6, 10.6, 90), "C1523", "eyes"),
    R("R17", "47k", "EYE_R_OUT", "VSENS", (31.6, 10.6, 90), "C25792", "eyes"),
    R("R15", "220", "IR_R_A", "VSENS", (32.6, 10.6, 90), "C25091", "eyes"),
    Part("Q2", "AO3401A", "Device:Q_PMOS_GSD", "Package_TO_SOT_SMD:SOT-23",
         {"1": "SENS_EN_N", "2": "+3V3", "3": "VSENS"}, (24.0, 7.3, 0), "AO3401A", "C15127", "eyes"),
    R("R13", "100k", "+3V3", "SENS_EN_N", (22.0, 4.6, 0), "C25741", "eyes"),
    C("C12", "100nF", "GND", "VSENS", (23.8, 10.6, 90), "C1525", "eyes"),

    # -- Accelerometer --
    Part("U4", "LIS2DH12", "DreamCatcher:LIS2DH12", "Package_LGA:LGA-12_2x2mm_P0.5mm",
         {"1": "I2C_SCL", "4": "I2C_SDA", "2": "+3V3", "3": "+3V3", "9": "+3V3", "10": "+3V3",
          "5": "GND", "6": "GND", "7": "GND", "8": "GND", "12": "ACC_INT1"},
         (ACC_X, ACC_Y, 0), "LIS2DH12TR", "C110926", "motion"),
    C("C9", "100nF", "GND", "+3V3", (30.75, 8.6, 90), "C1525", "motion"),
    R("R11", "4.7k", "I2C_SDA", "+3V3", (18.3, 8.0, 0), "C25900", "motion"),
    R("R12", "4.7k", "I2C_SCL", "+3V3", (18.3, 9.1, 0), "C25900", "motion"),
]

MAIN = Board(
    name="dreamcatcher-main",
    title="DreamCatcher main board",
    width=50.0, height=18.0, corner_radius=1.5, layers=4,
    parts=main_parts,
    keepouts=[(0.0, 0.0, 5.75, 18.0)],
    labels=[("DreamCatcher v1", 30.0, 9.0, 1.0, "B.SilkS"),
            # The back is the only place with room to name the pads
            ("3V3", 6.6, 2.4, 0.8, "B.SilkS"), ("TX", 8.75, 2.4, 0.8, "B.SilkS"),
            ("RX", 10.9, 2.4, 0.8, "B.SilkS"), ("BOOT", 32.3, 2.4, 0.8, "B.SilkS"),
            ("GND", 35.0, 2.4, 0.8, "B.SilkS"),
            ("BAT+", 44.6, 12.4, 0.8, "B.SilkS"), ("BAT-", 48.0, 12.4, 0.8, "B.SilkS"),
            ("EYE L", 21.1, 16.9, 0.8, "B.SilkS"), ("EYE R", 31.1, 16.9, 0.8, "B.SilkS"),
            ("USB", 46.0, 6.0, 0.8, "B.SilkS")],
    power_nets=("VBUS", "VBAT", "VSYS", "+3V3", "VSENS"),
    first_nets=("USB_DP", "USB_DM", "CC1", "CC2", "I2C_SDA", "I2C_SCL", "ACC_INT1", "LED_STAT_A"),
    # Ground vias placed by hand: the status LED's ground pad sits in a pocket the
    # ground pour can't reach, and the ground pins of the regulator and the USB
    # protection chip should each have a via of their own
    preroutes=ACCEL_ESCAPES + (("GND", 0.2, [(20.3, 7.8), (20.3, 9.0)]),
                               ("GND", 0.2, [(20.75, 2.2), (21.85, 2.2)]),
                               ("GND", 0.2, [(36.35, 6.0), (35.0, 6.0)])),
    pre_vias=(("GND", 20.3, 9.0), ("GND", 21.85, 2.2), ("GND", 35.0, 6.0)),
    groups=MAIN_GROUPS,
)

# ---- Eye sensor board (two per mask) ---------------------------------------------

sensor_parts = [
    Part("U1", "QRE1113GR", "Sensor_Proximity:QRE1113GR", "OptoDevice:OnSemi_CASE100CY",
         {"1": "IR_A", "2": "GND", "3": "OUT", "4": "GND"},
         (4.0, 2.5, 90), "QRE1113GR", "C232862", "sensor"),
    Part("D1", "RED", "Device:LED", FP_LED, {"2": "CUE_A", "1": "GND"},
         (4.0, 5.5, 0), "0603 red LED", "C2286", "sensor"),
    Part("J1", "TO MAIN", "Connector_Generic:Conn_01x04", "DreamCatcher:WirePads_1x04_P1.8mm",
         {"1": "CUE_A", "2": "GND", "3": "OUT", "4": "IR_A"},
         (4.0, 8.0, 0), group="sensor", assemble=False),
]

SENSOR = Board(
    name="dreamcatcher-eye-sensor",
    title="DreamCatcher eye sensor board",
    width=8.0, height=9.5, corner_radius=1.0,
    parts=sensor_parts,
    labels=[("1", 0.75, 6.5, 0.8, "F.SilkS"), ("4", 7.25, 6.5, 0.8, "F.SilkS")],
    groups=(("sensor", "IR reflectance sensor, cue LED, wire pads"),),
)

BOARDS = {"main": MAIN, "sensor": SENSOR}
