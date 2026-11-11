# DreamCatcher

A sleep mask that helps you lucid dream, and the phone app that goes with it.

The mask is an ESP32 with an infrared sensor over one eye. It watches for the eye
movements of REM sleep and flashes a dim light cue when it sees them, so you can
notice you're dreaming without being woken up. The app sets up the night over
Bluetooth, shows a report of it the next morning, and keeps a dream journal.

## What's in here

| Folder | What it is |
| --- | --- |
| [`DreamCatcherAppNew/`](DreamCatcherAppNew) | The React Native app (Android and iOS) |
| [`arduino/DreamCatcher_v3/`](arduino/DreamCatcher_v3) | The mask firmware. Its [README](arduino/DreamCatcher_v3/README.md) explains how REM is detected, how to tune it and the Bluetooth messages |
| [`arduino/IR_Stuff/`](arduino/IR_Stuff), [`arduino/storageCheck/`](arduino/storageCheck) | Small test sketches for the eye sensor and the ESP32's storage |
| [`arduino/libraries/`](arduino/libraries) | The QTRSensors library used by the `IR_Stuff` sketch |
| [`ToDoList.txt`](ToDoList.txt) | Ideas and things still to do |

## The app

```sh
cd DreamCatcherAppNew
npm install
npm run android   # or: npm run ios (run `pod install` in ios/ first)
```

It needs a real phone for Bluetooth; set one up with the
[React Native environment guide](https://reactnative.dev/docs/set-up-your-environment).

The app has four tabs:

- **Dream Catcher** (the first tab, `src/screens/ConnectScreen.tsx`): scan for and connect to the mask, set the
  cue brightness and REM sensitivity, run the live sensor test, send the night's time
  window, and download the night report.
- **Journal**: write down your dreams. Entries are kept on the phone.
- **Learn**: short reads about dreaming and lucid dreaming.
- **Profile**: your name and goal, and stats counted from the journal.

`src/ble/maskProtocol.ts` reads the messages the mask sends. It has to stay in step
with the firmware's README.

Checks:

```sh
npm test          # Jest
npm run lint      # ESLint
npx tsc --noEmit  # TypeScript
```

## The mask

Hardware: an ESP32 dev board, a QTR-1A reflectance sensor (power on GPIO 27, output on
GPIO 32) and the cue LED on GPIO 26.

Open `arduino/DreamCatcher_v3/DreamCatcher_v3.ino` in the Arduino IDE with the ESP32
boards package (version 3 or later) installed, and upload it to the board.

The detection logic lives in `DreamLogic.h`, which runs on a computer too:

```sh
arduino/DreamCatcher_v3/test/run_tests.sh   # needs g++ or clang++
```
