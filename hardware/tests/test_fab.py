"""Do the files sent to the factory match the design?

The factory builds from three files: the Gerbers (copper, holes, outline), the bill of
materials (which part goes with which label) and the placement list (where each part
sits). A part missing from one of them is a board that arrives incomplete.
"""

import csv
import os
import re
import unittest
import zipfile

import pcbnew

from design import eye_board, main_board

BOARDS = {"main": main_board, "eye": eye_board}


def read_csv(design, suffix):
    with open(os.path.join(design.folder, "fab", f"{design.name}-{suffix}.csv")) as f:
        return list(csv.DictReader(f))


def assembled(design):
    """Parts the factory solders: everything except bare pads."""
    skip = pcbnew.FP_EXCLUDE_FROM_BOM
    return {ref for ref, fp in design.footprints.items() if not fp.GetAttributes() & skip}


class FactoryFiles(unittest.TestCase):
    def test_schematic_and_board_agree(self):
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                d = load()
                board = {(ref, pad.GetNumber()): pad.GetNetname() or None
                         for ref, fp in d.footprints.items() for pad in fp.Pads()}
                for key, net in d.net_of.items():
                    self.assertEqual(board.get(key), net, f"{key[0]} pin {key[1]}")
                for key, net in board.items():
                    if net:
                        self.assertEqual(d.net_of.get(key), net, f"{key[0]} pad {key[1]}")
                for ref, footprint in d.footprints.items():
                    self.assertEqual(footprint.GetValue(), d.value[ref], ref)

    def test_bill_of_materials_lists_every_part_once(self):
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                d = load()
                listed = [ref for row in read_csv(d, "bom") for ref in row["Designator"].split(",")]
                self.assertEqual(len(listed), len(set(listed)), "a part is listed twice")
                self.assertEqual(set(listed), assembled(d))

    def test_every_part_has_an_order_number(self):
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                for row in read_csv(load(), "bom"):
                    self.assertRegex(row["LCSC Part #"], r"^C\d+$", row["Designator"])

    def test_one_order_number_means_one_kind_of_part(self):
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                seen = {}
                for row in read_csv(load(), "bom"):
                    kind = (row["MPN"], row["Footprint"])
                    self.assertEqual(seen.setdefault(row["LCSC Part #"], kind), kind, row["LCSC Part #"])

    def test_bill_of_materials_values_match_the_schematic(self):
        d = main_board()
        for row in read_csv(d, "bom"):
            for ref in row["Designator"].split(","):
                self.assertEqual(row["Comment"], d.value[ref], ref)

    def test_placement_list_covers_every_part_at_its_position(self):
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                d = load()
                rows = {row["Designator"]: row for row in read_csv(d, "cpl")}
                self.assertEqual(set(rows), assembled(d))
                for ref, row in rows.items():
                    position = d.footprints[ref].GetPosition()
                    # Placement files measure y upwards; KiCad measures it downwards
                    self.assertAlmostEqual(float(row["Mid X"]), pcbnew.ToMM(position.x), places=3, msg=ref)
                    self.assertAlmostEqual(float(row["Mid Y"]), -pcbnew.ToMM(position.y), places=3, msg=ref)
                    self.assertEqual(row["Layer"], "Top", ref)
                    self.assertAlmostEqual(float(row["Rotation"]) % 360,
                                           d.footprints[ref].GetOrientationDegrees() % 360, places=3, msg=ref)

    def test_bare_pads_are_not_ordered_as_parts(self):
        d = main_board()
        for ref in d.refs("TP") + ["BT1"]:
            self.assertNotIn(ref, assembled(d))

    def test_gerber_archive_has_every_layer(self):
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                d = load()
                with zipfile.ZipFile(os.path.join(d.folder, "fab", d.name + "-gerbers.zip")) as archive:
                    names = archive.namelist()
                    sizes = {n: archive.getinfo(n).file_size for n in names}
                copper = ["F_Cu", "B_Cu"] + (["In1_Cu", "In2_Cu"] if d.board.GetCopperLayerCount() == 4 else [])
                for layer in copper + ["F_Mask", "B_Mask", "F_Paste", "F_Silkscreen", "Edge_Cuts"]:
                    matches = [n for n in names if re.search(rf"-{layer}\.", n)]
                    self.assertEqual(len(matches), 1, layer)
                    self.assertGreater(sizes[matches[0]], 200, f"{layer} is empty")
                self.assertTrue(any(n.endswith("-PTH.drl") for n in names), "no drill file")
                inner = [n for n in names if "In" in n and "_Cu" in n]
                self.assertEqual(len(inner), len(copper) - 2, "inner layers don't match the layer count")

    def test_factory_files_are_newer_than_the_board(self):
        """Catches a board edited in KiCad without exporting the factory files again."""
        for name, load in BOARDS.items():
            with self.subTest(board=name):
                d = load()
                board_time = os.path.getmtime(os.path.join(d.folder, d.name + ".kicad_pcb"))
                for file in os.listdir(os.path.join(d.folder, "fab")):
                    self.assertGreaterEqual(os.path.getmtime(os.path.join(d.folder, "fab", file)), board_time, file)


if __name__ == "__main__":
    unittest.main()
