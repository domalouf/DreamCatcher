#!/bin/sh
# Builds and runs the DreamLogic.h tests on this computer (needs g++ or clang++).
set -e
cd "$(dirname "$0")"
CXX="${CXX:-g++}"
"$CXX" -std=c++17 -O2 -Wall -Wextra -Werror -o night_sim night_sim.cpp
./night_sim
