# DreamCatcher v3 firmware

Detects REM sleep with the QTR-1A eye sensor and flashes a dream cue, so you can
recognise you're dreaming (lucid dreaming) without being woken up.

## A night with the mask

1. **Reset the mask.** It blinks briefly every 2 s while it waits for the app.
2. **In the app**, connect, then pick the dream window's start and end times and tap
   *Submit Time Window*. The app also sends the cue brightness, detection sensitivity
   and the current time. The mask deep sleeps until the window starts.
3. **During the window** the mask reads the eye sensor 25 times a second (light
   sleeping in between) and flashes the cue when it sees REM. See
   [How REM is detected](#how-rem-is-detected).
4. **When the window ends** the mask saves the night's log and waits quietly (no
   blinking) for the app. Tap *Download Last Night* to see when you were in REM and
   how you reacted to each cue. After 2 hours without a connection the mask deep
   sleeps until you reset it.

## How REM is detected

The sensor shines infrared at your closed eyelid. When your eye moves, the bulge of
the cornea slides under the lid and the reflected light changes. During REM your eyes
make bursts of quick jumps; during other sleep they're still, and when you're awake
you also move your head.

- **Eye movement**: the reading changes sharply (well above its normal noise) within
  120 ms and settles again within ~0.5 s.
- **Body movement**: a change that is very large (the mask shifting on your face) or
  lasts longer than ~0.5 s. The sensor reading going out of range also counts.
- **REM**: in the last minute there were enough eye movements (7 at the default
  sensitivity), spread over at least two 10 s stretches, and no body movements in the
  last 2 minutes.
- **Cue**: once REM has been seen on two checks in a row (10 s apart). Then:
  - at least 5 minutes between cues, and at most 10 a night;
  - if you move within a minute of a cue it assumes the cue woke you: the next cue is
    30% dimmer and waits 10 minutes;
  - if you sleep through it, the next cue is 15% brighter.

  The brightness carries over to the next night, so over a few nights it settles just
  below the level that wakes you.

All of this lives in [`DreamLogic.h`](DreamLogic.h), which has no Arduino dependencies.
[`test/run_tests.sh`](test/run_tests.sh) runs it against simulated nights on a computer.

## Tuning once the sensor is mounted

The thresholds are starting points chosen without real overnight recordings.

1. Put the mask on, connect, and start the **Sensor Test** in the app. It shows the live
   reading, marks detected eye (orange) and body (red) movements, and counts eye
   movements in the last minute.
2. **Position**: the reading should sit comfortably inside 0-4095 and not hit either
   end. If it says *bad signal*, move the sensor closer to or further from the eyelid
   (the QTR-1A works best 3-6 mm away).
3. **Eyes closed and still** for a minute: there should be few or no eye movements. If
   there are many, lower the sensitivity.
4. **Look left and right** with your eyes closed: each movement should be marked. If
   they're missed, raise the sensitivity. If they show up as body movements, raise
   `BODY_MIN_CHANGE` in `DreamLogic.h`.
5. **Move your head** or adjust the mask: it should show a body movement.
6. After a real night, compare *Download Last Night* with how you slept.

Sensitivity (1-5) and cue brightness can be changed from the app. Everything else is a
named constant near the top of `DreamLogic.h` or `DreamCatcher_v3.ino`.

## Power

- Readings are taken with the CPU in light sleep between them, the sensor powered only
  for ~1 ms per reading, and the CPU at 80 MHz. That should keep the ESP32 itself to a
  few mA overnight. Dev board parts like the USB chip, power LED and voltage regulator
  draw extra current that firmware can't turn off.
- While waiting for the phone, Bluetooth advertises every 250-500 ms, and the mask gives
  up after 2 hours.
- The ESP32's internal sleep clock isn't very accurate. The window may start a few
  minutes early or late after a long deep sleep.

## Bluetooth commands

All messages go over one characteristic (`8b38e5b5-...`) in service `7504e3b0-...`.
Messages are plain text of 20 bytes or less, the most a phone accepts without
negotiating more.

App to mask:

| Command | Effect |
| --- | --- |
| `light: on` / `light: off` | LEDs fully on / off |
| `trick: yes` | Flash the built-in LED |
| `cue: preview` | Flash the dream cue at the current brightness |
| `cue: <1-100>` | Set the cue brightness in percent (replies with `S:`) |
| `sens: <1-5>` | Set the detection sensitivity (replies with `S:`) |
| `status: get` | Reply with `S:` |
| `test: start` / `test: stop` | Start / stop the sensor test |
| `log: get` | Send the last night's log |
| `now: <unix seconds>` | The phone's clock, so the log has real times |
| `startTime: <seconds>` | Seconds until the dream window starts |
| `scanTime: <seconds>` | Length of the dream window. Once both are set, the mask sleeps until the window. |

Mask to app:

| Message | Meaning |
| --- | --- |
| `ACK: <text>` | A command was carried out |
| `S:<has log>,<cue %>,<sensitivity>` | Status |
| `<ms>,<reading>,<movement>` | Sensor test reading. Movement is 0 none, 1 eye, 2 body. 25 per second. |
| `B:<eye movements>,<REM-like>` | Sensor test summary every 10 s: eye movements in the last minute, and whether that looks like REM |
| `TEST_END` | Sensor test finished (stopped, or after 5 minutes) |
| `LOG_NONE` | No night has been recorded yet |
| `LOG:<epochs>,<cues>` | Start of the night log |
| `LS:<start unix>,<epoch seconds>` | When the window started (0 if unknown) and epoch length |
| `LV:<sensitivity>,<start cue %>,<end cue %>` | Settings used |
| `E<index>:<hex>` | Up to 4 epochs starting at `index`. Each epoch is 3 hex digits: 2 for eye movements, 1 for flags (1 body movement, 2 REM, 4 cue, 8 bad signal) |
| `C:<epoch>,<cue %>,<outcome>` | A cue. Outcome is 0 unknown, 1 slept through, 2 woke up. |
| `LOG_END` | End of the night log |
