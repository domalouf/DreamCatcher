"""Regenerates everything under hardware/ from boards.py.

    python3 build.py              both boards
    python3 build.py main         one board
    python3 build.py --keep-pcb   don't re-route; redo the schematic, checks and outputs

Needs KiCad 7 or newer (kicad-cli and its Python module) and rsvg-convert for the
preview images. Routing the main board takes several minutes.
"""

import csv
import glob
import os
import re
import shutil
import subprocess
import sys
import zipfile

import pcbnew

import gen_pcb
import gen_sch
import libs
from boards import BOARDS
from sexpr import find, first, parse

HERE = os.path.dirname(os.path.abspath(__file__))


def run(*args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode:
        raise SystemExit(f"{' '.join(args)}\n{result.stdout}{result.stderr}")


def check_nets(spec, out_dir):
    """The schematic and the board must both carry exactly the nets in boards.py."""
    wanted = {(part.ref, pin): net for part in spec.parts for pin, net in part.pins.items()}

    netlist_path = os.path.join(out_dir, "netlist.tmp")
    run("kicad-cli", "sch", "export", "netlist", "-o", netlist_path,
        os.path.join(out_dir, spec.name + ".kicad_sch"))
    netlist = parse(open(netlist_path).read())
    os.remove(netlist_path)
    schematic = {}
    for net in find(first(netlist, "nets"), "net"):
        name = first(net, "name")[1]
        if name.startswith("unconnected-"):
            continue
        for node in find(net, "node"):
            schematic[(first(node, "ref")[1], first(node, "pin")[1])] = name.lstrip("/")
    schematic = {k: v for k, v in schematic.items() if not k[0].startswith("#")}

    board = pcbnew.LoadBoard(os.path.join(out_dir, spec.name + ".kicad_pcb"))
    layout = {(fp.GetReference(), pad.GetNumber()): pad.GetNetname()
              for fp in board.GetFootprints() for pad in fp.Pads() if pad.GetNetname()}

    problems = 0
    for name, found in (("schematic", schematic), ("board", layout)):
        for key in sorted(set(wanted) | set(found)):
            if wanted.get(key) != found.get(key):
                problems += 1
                print(f"  {name}: {key[0]} pin {key[1]} is on {found.get(key)}, should be {wanted.get(key)}")
    print(f"  nets: {len(wanted)} pins checked in schematic and board, {problems} mismatches")
    return problems


def fabrication_files(spec, out_dir):
    pcb = os.path.join(out_dir, spec.name + ".kicad_pcb")
    fab = os.path.join(out_dir, "fab")
    shutil.rmtree(fab, ignore_errors=True)
    gerbers = os.path.join(fab, "gerbers")
    os.makedirs(gerbers)

    copper = ["F.Cu", "B.Cu"] if spec.layers == 2 else ["F.Cu", "In1.Cu", "In2.Cu", "B.Cu"]
    layers = copper + ["F.Paste", "B.Paste", "F.SilkS", "B.SilkS", "F.Mask", "B.Mask", "Edge.Cuts"]
    run("kicad-cli", "pcb", "export", "gerbers", "-o", gerbers + "/", "--layers", ",".join(layers),
        "--subtract-soldermask", pcb)
    run("kicad-cli", "pcb", "export", "drill", "-o", gerbers + "/", "--excellon-separate-th", pcb)
    with zipfile.ZipFile(os.path.join(fab, spec.name + "-gerbers.zip"), "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(glob.glob(gerbers + "/*")):
            archive.write(path, os.path.basename(path))
    shutil.rmtree(gerbers)

    # Bill of materials and placement list in the column layout JLCPCB's assembly service reads
    groups = {}
    for part in spec.parts:
        if part.assemble:
            groups.setdefault((part.value, part.footprint.split(":")[1], part.mpn, part.lcsc), []).append(part.ref)
    with open(os.path.join(fab, spec.name + "-bom.csv"), "w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["Comment", "Designator", "Footprint", "MPN", "LCSC Part #"])
        for (value, footprint, mpn, lcsc), refs in sorted(groups.items(), key=lambda g: g[1][0]):
            writer.writerow([value, ",".join(refs), footprint, mpn, lcsc])

    positions = os.path.join(fab, "positions.tmp")
    run("kicad-cli", "pcb", "export", "pos", "-o", positions, "--format", "csv", "--units", "mm", pcb)
    with open(positions) as f:
        rows = list(csv.DictReader(f))
    os.remove(positions)
    placed = {part.ref for part in spec.parts if part.assemble}
    with open(os.path.join(fab, spec.name + "-cpl.csv"), "w", newline="") as f:
        writer = csv.writer(f, lineterminator="\n")
        writer.writerow(["Designator", "Mid X", "Mid Y", "Layer", "Rotation"])
        for row in rows:
            if row["Ref"] in placed:
                writer.writerow([row["Ref"], row["PosX"], row["PosY"],
                                 "Top" if row["Side"] == "top" else "Bottom", row["Rot"]])
    print(f"  fab: {len(groups)} BOM lines, {len(placed)} parts to place")


def previews(spec, out_dir):
    docs = os.path.join(out_dir, "docs")
    os.makedirs(docs, exist_ok=True)
    pcb = os.path.join(out_dir, spec.name + ".kicad_pcb")
    run("kicad-cli", "sch", "export", "pdf", "-o", os.path.join(docs, "schematic.pdf"),
        os.path.join(out_dir, spec.name + ".kicad_sch"))
    views = {"front": "F.Cu,F.SilkS,F.Fab,Edge.Cuts", "back": "B.Cu,B.SilkS,Edge.Cuts",
             "assembly": "F.Fab,F.CrtYd,F.Paste,Edge.Cuts"}
    if spec.layers == 4:
        views["inner2"] = "In2.Cu,Edge.Cuts"
    zoom = str(max(4, round(1400 / spec.width / 3.78)))
    for name, layers in views.items():
        svg = os.path.join(docs, name + ".svg")
        run("kicad-cli", "pcb", "export", "svg", "-o", svg, "--layers", layers,
            "--page-size-mode", "2", "--exclude-drawing-sheet", pcb)
        if shutil.which("rsvg-convert"):
            run("rsvg-convert", "-z", zoom, "-b", "white", svg, "-o", os.path.join(docs, name + ".png"))
        os.remove(svg)


def main():
    names = [a for a in sys.argv[1:] if not a.startswith("--")] or list(BOARDS)
    libs.write_symbols()
    libs.write_footprints()
    problems = 0
    for name in names:
        spec = BOARDS[name]
        out_dir = os.path.normpath(os.path.join(HERE, "..", spec.name))
        print(spec.name)
        if "--keep-pcb" not in sys.argv:
            problems += gen_pcb.build(spec)
        gen_sch.build(spec)
        problems += check_nets(spec, out_dir)
        fabrication_files(spec, out_dir)
        previews(spec, out_dir)
        for leftover in glob.glob(os.path.join(out_dir, "*.kicad_prl")) + glob.glob(os.path.join(out_dir, "fp-info-cache")):
            os.remove(leftover)
    print("OK" if not problems else f"{problems} PROBLEMS")
    sys.exit(1 if problems else 0)


if __name__ == "__main__":
    main()
