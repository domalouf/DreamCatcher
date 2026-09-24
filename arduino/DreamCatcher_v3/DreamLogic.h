/*
  DreamLogic.h - REM detection, cue timing and the night log for the DreamCatcher mask.

  Plain C++ with no Arduino dependencies, so it can be tested on a computer
  (see test/). The sketch feeds it one eye sensor reading every SAMPLE_MS and
  flashes the cue light when it's told to.

  How REM is detected
  -------------------
  The QTR-1A shines infrared light at the closed eyelid. When the eye moves, the
  bulge of the cornea slides under the lid and the amount of reflected light
  changes. During REM sleep the eyes make bursts of quick jumps (saccades);
  during non-REM sleep they are still or drift slowly; and when you're awake you
  also move your head and body.

  1. MovementDetector compares how much the signal changed over the last 120 ms
     with the sensor's normal noise level (which it keeps learning). A short,
     sharp change is an eye movement; a long or very large one is a body/mask
     movement.
  2. RemTracker counts movements in 10 s bins. The last minute looks like REM
     when it has enough eye movements, spread over at least two bins, and there
     were no body movements in the last 2 minutes (the body is paralysed in REM).
  3. CueController flashes the cue once REM has been seen on two checks in a
     row, then waits for the cooldown. If you move within a minute of a cue it
     assumes the cue woke you: the next cue is dimmer and comes later. If you
     don't react, the next cue is a little brighter. Over a few nights the
     brightness settles just below the level that wakes you.

  The thresholds below are starting points. Tune them with the Sensor Test in
  the app once the sensor is mounted in the mask.
*/

#pragma once

#include <math.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace dc {

// ---- Timing ---------------------------------------------------------------

constexpr uint32_t SAMPLE_MS = 40;         // 25 readings per second
constexpr uint32_t BIN_MS = 10000;         // movements are counted in 10 s bins
constexpr uint8_t BINS_PER_EPOCH = 3;      // the night log stores 30 s epochs
constexpr uint16_t EPOCH_SEC = BIN_MS * BINS_PER_EPOCH / 1000;
constexpr uint16_t MAX_EPOCHS = 1200;      // longest window: 10 hours
constexpr uint32_t MAX_WINDOW_SEC = (uint32_t)MAX_EPOCHS * EPOCH_SEC;
constexpr uint8_t MAX_CUE_EVENTS = 30;

// ---- Eye movement detection -----------------------------------------------

// Readings outside this range mean the sensor is saturated: too close, too
// far, or not facing the eye.
constexpr uint16_t ADC_MIN_VALID = 30;
constexpr uint16_t ADC_MAX_VALID = 4065;

constexpr uint8_t CHANGE_LAG = 3;          // compare with the reading 120 ms earlier
constexpr uint8_t WARMUP_SAMPLES = 50;     // first 2 s set the initial noise level
constexpr float NOISE_ALPHA = 1.0f / 750;  // noise level adapts over ~30 s
constexpr float NOISE_FLOOR = 1.5f;        // never treat the signal as quieter than this
constexpr float BODY_NOISE_MULTIPLE = 40;  // a change this many times the noise is a body movement...
constexpr float BODY_MIN_CHANGE = 250;     // ...as long as it's also at least this many ADC counts
constexpr uint8_t EYE_MAX_SAMPLES = 12;    // movements lasting longer than ~0.5 s aren't eye movements
constexpr uint8_t END_QUIET_SAMPLES = 3;   // a movement ends after 120 ms of quiet
constexpr uint8_t EYE_REFRACTORY = 3;      // ignore 120 ms after an eye movement
constexpr uint8_t BODY_HOLDOFF = 50;       // after a body movement, wait for 2 s of stillness
constexpr uint8_t RESUME_HOLDOFF = 25;     // ignore 1 s after sampling resumes (e.g. after a cue)

// ---- Settings -------------------------------------------------------------

constexpr uint8_t MIN_SENSITIVITY = 1;
constexpr uint8_t MAX_SENSITIVITY = 5;
constexpr uint8_t MIN_CUE_LEVEL = 3;       // percent
constexpr uint8_t MAX_CUE_LEVEL = 100;

struct Settings {
  uint8_t sensitivity = 3;        // 1 = only obvious REM ... 5 = most eager
  uint8_t cueLevel = 30;          // cue brightness in percent; adapted every night
  uint8_t maxCues = 10;           // most cues in one night
  uint16_t cueCooldownSec = 300;  // least time between cues
};

inline uint8_t clampU8(int value, int lo, int hi) {
  return (uint8_t)(value < lo ? lo : (value > hi ? hi : value));
}

inline uint8_t sensitivityIndex(uint8_t sensitivity) {
  return clampU8(sensitivity, MIN_SENSITIVITY, MAX_SENSITIVITY) - MIN_SENSITIVITY;
}

enum class Movement : uint8_t { None = 0, Eye = 1, Body = 2 };

// Classifies each reading as part of an eye movement, a body movement, or neither.
class MovementDetector {
 public:
  explicit MovementDetector(uint8_t sensitivity = 3) {
    setSensitivity(sensitivity);
    reset();
  }

  void setSensitivity(uint8_t sensitivity) {
    // How many times the noise level a change must be to count as an eye movement
    static const float kEyeThreshold[] = {12.0f, 9.0f, 7.0f, 5.5f, 4.5f};
    eyeMultiple_ = kEyeThreshold[sensitivityIndex(sensitivity)];
  }

  // Forget the recent readings, e.g. after sampling paused while the cue flashed.
  // The learned noise level is kept.
  void reset() {
    count_ = 0;
    inMovement_ = false;
    holdoff_ = RESUME_HOLDOFF;
  }

  Movement addSample(uint16_t raw) {
    if (raw < ADC_MIN_VALID || raw > ADC_MAX_VALID) {
      // Losing the signal almost always means the mask moved (or came off)
      const bool wasOk = signalOk_;
      signalOk_ = false;
      count_ = 0;
      inMovement_ = false;
      holdoff_ = BODY_HOLDOFF;
      settlingAfterBody_ = true;
      return wasOk ? Movement::Body : Movement::None;
    }
    signalOk_ = true;

    for (uint8_t i = CHANGE_LAG; i > 0; i--) {
      history_[i] = history_[i - 1];
    }
    history_[0] = raw;
    if (count_ < CHANGE_LAG) {
      count_++;
      return Movement::None;
    }
    const float change = fabsf((float)history_[0] - (float)history_[CHANGE_LAG]);

    if (warmup_ < WARMUP_SAMPLES) {
      warmupSum_ += change;
      if (++warmup_ == WARMUP_SAMPLES) {
        noise_ = warmupSum_ / WARMUP_SAMPLES;
        if (noise_ < NOISE_FLOOR) {
          noise_ = NOISE_FLOOR;
        }
      }
      return Movement::None;
    }

    const float eyeThreshold = noise_ * eyeMultiple_;
    if (holdoff_ > 0) {
      // Keep waiting while a body movement is still going, so it's only reported once
      holdoff_ = settlingAfterBody_ && change > eyeThreshold ? BODY_HOLDOFF : holdoff_ - 1;
      return Movement::None;
    }
    settlingAfterBody_ = false;

    if (!inMovement_) {
      if (change > eyeThreshold) {
        inMovement_ = true;
        bodyReported_ = false;
        length_ = 1;
        quiet_ = 0;
        peak_ = change;
      } else {
        learnNoise(change);
      }
      return Movement::None;
    }

    // Inside a movement: follow it until the signal has been quiet for a moment
    length_++;
    if (change > peak_) {
      peak_ = change;
    }
    quiet_ = change > eyeThreshold * 0.5f ? 0 : quiet_ + 1;

    if (!bodyReported_ && (length_ - quiet_ > EYE_MAX_SAMPLES || peak_ >= bodyThreshold())) {
      // Report body movements straight away rather than when they finish
      bodyReported_ = true;
      return Movement::Body;
    }
    if (quiet_ < END_QUIET_SAMPLES) {
      return Movement::None;
    }

    inMovement_ = false;
    if (bodyReported_) {
      holdoff_ = BODY_HOLDOFF;
      settlingAfterBody_ = true;
      return Movement::None;
    }
    holdoff_ = EYE_REFRACTORY;
    return Movement::Eye;
  }

  bool signalOk() const { return signalOk_; }
  float noise() const { return noise_; }

 private:
  float bodyThreshold() const {
    const float relative = noise_ * BODY_NOISE_MULTIPLE;
    return relative > BODY_MIN_CHANGE ? relative : BODY_MIN_CHANGE;
  }

  void learnNoise(float change) {
    // Clip big changes so the odd movement doesn't inflate the noise level
    const float limited = change < 3 * noise_ ? change : 3 * noise_;
    noise_ += (limited - noise_) * NOISE_ALPHA;
    if (noise_ < NOISE_FLOOR) {
      noise_ = NOISE_FLOOR;
    }
  }

  float eyeMultiple_ = 7.0f;
  uint16_t history_[CHANGE_LAG + 1] = {};
  uint8_t count_ = 0;
  uint8_t warmup_ = 0;
  float warmupSum_ = 0;
  float noise_ = NOISE_FLOOR;
  uint8_t holdoff_ = 0;
  bool settlingAfterBody_ = false;
  bool signalOk_ = true;
  bool inMovement_ = false;
  bool bodyReported_ = false;
  uint8_t length_ = 0;
  uint8_t quiet_ = 0;
  float peak_ = 0;
};

struct BinSummary {
  uint8_t eyeMoves = 0;
  bool bodyMovement = false;
  bool badSignal = false;  // over half the bin's readings were unusable
  bool remLike = false;    // the minute ending with this bin looked like REM
};

// Groups movements into 10 s bins and decides whether the last minute looks like REM.
class RemTracker {
 public:
  static constexpr uint8_t LOOKBACK_BINS = 6;  // judge REM on the last minute...
  static constexpr uint8_t QUIET_BINS = 12;    // ...with no body movement in the last 2 minutes

  explicit RemTracker(uint8_t sensitivity = 3) {
    setSensitivity(sensitivity);
    reset();
  }

  void setSensitivity(uint8_t sensitivity) {
    // Eye movements needed in the last minute to call it REM
    static const uint8_t kMinEyeMoves[] = {12, 9, 7, 5, 4};
    minEyeMoves_ = kMinEyeMoves[sensitivityIndex(sensitivity)];
  }

  void reset() {
    for (uint8_t i = 0; i < QUIET_BINS; i++) {
      history_[i] = BinSummary();
    }
    current_ = BinSummary();
    next_ = 0;
    binsSeen_ = 0;
    samples_ = 0;
    badSamples_ = 0;
    remStreak_ = 0;
  }

  void addSample(bool signalOk, Movement movement) {
    samples_++;
    if (!signalOk) {
      badSamples_++;
    }
    if (movement == Movement::Eye && current_.eyeMoves < 255) {
      current_.eyeMoves++;
    } else if (movement == Movement::Body) {
      current_.bodyMovement = true;
    }
  }

  BinSummary closeBin() {
    // A bin with no readings at all (sampling paused) isn't a bad signal, just a gap
    current_.badSignal = samples_ > 0 && badSamples_ * 2 > samples_;
    history_[next_] = current_;
    next_ = (uint8_t)((next_ + 1) % QUIET_BINS);
    if (binsSeen_ < QUIET_BINS) {
      binsSeen_++;
    }

    const bool rem = looksLikeRem();
    history_[(next_ + QUIET_BINS - 1) % QUIET_BINS].remLike = rem;
    remStreak_ = rem ? (remStreak_ < 255 ? remStreak_ + 1 : 255) : 0;

    BinSummary closed = current_;
    closed.remLike = rem;
    current_ = BinSummary();
    samples_ = 0;
    badSamples_ = 0;
    return closed;
  }

  bool remLike() const { return remStreak_ > 0; }
  // REM seen on at least two checks in a row, which filters out one-off bursts
  bool remSustained() const { return remStreak_ >= 2; }

  uint16_t eyeMovesLastMinute() const {
    uint16_t total = 0;
    for (uint8_t age = 0; age < LOOKBACK_BINS && age < binsSeen_; age++) {
      total += bin(age).eyeMoves;
    }
    return total;
  }

 private:
  // age 0 is the most recently closed bin
  const BinSummary& bin(uint8_t age) const {
    return history_[(next_ + QUIET_BINS - 1 - age) % QUIET_BINS];
  }

  bool looksLikeRem() const {
    if (binsSeen_ < LOOKBACK_BINS) {
      return false;
    }
    uint16_t eyeMoves = 0;
    uint8_t binsWithMoves = 0;
    for (uint8_t age = 0; age < binsSeen_; age++) {
      const BinSummary& b = bin(age);
      if (b.bodyMovement) {
        return false;
      }
      if (age < LOOKBACK_BINS) {
        if (b.badSignal) {
          return false;
        }
        eyeMoves += b.eyeMoves;
        if (b.eyeMoves > 0) {
          binsWithMoves++;
        }
      }
    }
    return eyeMoves >= minEyeMoves_ && binsWithMoves >= 2;
  }

  uint8_t minEyeMoves_ = 7;
  BinSummary history_[QUIET_BINS];
  BinSummary current_;
  uint8_t next_ = 0;
  uint8_t binsSeen_ = 0;
  uint16_t samples_ = 0;
  uint16_t badSamples_ = 0;
  uint8_t remStreak_ = 0;
};

enum class CueOutcome : uint8_t { Pending = 0, NoReaction = 1, Woke = 2 };

// Decides when to flash the cue and adapts its brightness to how you react.
class CueController {
 public:
  static constexpr uint32_t RESPONSE_SEC = 60;  // movement this soon after a cue counts as waking up

  void begin(const Settings& settings) {
    settings_ = settings;
    level_ = clampU8(settings.cueLevel, MIN_CUE_LEVEL, MAX_CUE_LEVEL);
    cuesGiven_ = 0;
    waitingForReaction_ = false;
    lastOutcome_ = CueOutcome::Pending;
    nextAllowedSec_ = 0;
  }

  // Called at the end of every bin with whether you moved during it
  void observe(uint32_t nowSec, bool bodyMovement) {
    if (waitingForReaction_) {
      if (bodyMovement) {
        // Probably woke up: dim the next cue and give them longer to fall back asleep
        lastOutcome_ = CueOutcome::Woke;
        level_ = clampU8(level_ - maxInt(1, level_ * 30 / 100), MIN_CUE_LEVEL, MAX_CUE_LEVEL);
        nextAllowedSec_ = cueSec_ + 2 * (uint32_t)settings_.cueCooldownSec;
        waitingForReaction_ = false;
      } else if (nowSec - cueSec_ >= RESPONSE_SEC) {
        // Slept through it: it may not have been noticed, so make the next one a little brighter
        lastOutcome_ = CueOutcome::NoReaction;
        level_ = clampU8(level_ + maxInt(1, level_ * 15 / 100), MIN_CUE_LEVEL, MAX_CUE_LEVEL);
        waitingForReaction_ = false;
      }
    }
  }

  // Called after observe(). Returns the brightness to flash now, or 0 for no cue.
  uint8_t maybeCue(uint32_t nowSec, bool remSustained) {
    if (!waitingForReaction_ && remSustained && cuesGiven_ < settings_.maxCues &&
        nowSec >= nextAllowedSec_) {
      waitingForReaction_ = true;
      lastOutcome_ = CueOutcome::Pending;
      cueSec_ = nowSec;
      nextAllowedSec_ = nowSec + settings_.cueCooldownSec;
      cuesGiven_++;
      return level_;
    }
    return 0;
  }

  uint8_t level() const { return level_; }
  uint8_t cuesGiven() const { return cuesGiven_; }
  // How you reacted to the most recent cue (Pending until known)
  CueOutcome lastOutcome() const { return lastOutcome_; }

 private:
  static int maxInt(int a, int b) { return a > b ? a : b; }

  Settings settings_;
  uint8_t level_ = 30;
  uint8_t cuesGiven_ = 0;
  bool waitingForReaction_ = false;
  CueOutcome lastOutcome_ = CueOutcome::Pending;
  uint32_t cueSec_ = 0;
  uint32_t nextAllowedSec_ = 0;
};

enum EpochFlags : uint8_t {
  EPOCH_BODY = 1,        // body/mask movement
  EPOCH_REM = 2,         // looked like REM at some point
  EPOCH_CUE = 4,         // the cue was flashed
  EPOCH_BAD_SIGNAL = 8,  // the sensor couldn't see the eye properly
};

struct EpochRecord {
  uint8_t eyeMoves;
  uint8_t flags;
};

struct CueEvent {
  uint16_t epoch;
  uint8_t level;
  CueOutcome outcome;
};

// Everything recorded about one night. Saved to flash as-is, so only append new fields.
struct NightLog {
  static constexpr uint32_t MAGIC = 0x3144434E;  // "NCD1"

  uint32_t magic;
  uint32_t startUnix;  // when the window started, or 0 if the app didn't send the time
  uint16_t epochSec;
  uint16_t epochCount;
  uint8_t startLevel;  // cue brightness at the start and end of the night
  uint8_t endLevel;
  uint8_t cueCount;
  uint8_t sensitivity;
  CueEvent cues[MAX_CUE_EVENTS];
  EpochRecord epochs[MAX_EPOCHS];  // keep last: only the used part is saved

  void clear() {
    memset(this, 0, sizeof(*this));
    magic = MAGIC;
    epochSec = EPOCH_SEC;
  }

  size_t usedBytes() const {
    return offsetof(NightLog, epochs) + (size_t)epochCount * sizeof(EpochRecord);
  }

  bool isValid(size_t length) const {
    return magic == MAGIC && epochCount <= MAX_EPOCHS && cueCount <= MAX_CUE_EVENTS &&
           length >= usedBytes();
  }
};

// Runs one night: feeds readings through the detector, decides on cues and fills in the log.
class NightSession {
 public:
  void begin(const Settings& settings, uint32_t startUnix, uint32_t windowSec) {
    windowMs_ = (windowSec < MAX_WINDOW_SEC ? windowSec : MAX_WINDOW_SEC) * 1000UL;
    detector_ = MovementDetector(settings.sensitivity);
    tracker_ = RemTracker(settings.sensitivity);
    cues_.begin(settings);
    log_.clear();
    log_.startUnix = startUnix;
    log_.startLevel = cues_.level();
    log_.endLevel = cues_.level();
    log_.sensitivity = settings.sensitivity;
    binsClosed_ = 0;
    binsInEpoch_ = 0;
    epoch_ = EpochRecord{0, 0};
  }

  bool finished(uint32_t elapsedMs) const {
    return elapsedMs >= windowMs_ || log_.epochCount >= MAX_EPOCHS;
  }

  // Feed one reading taken `elapsedMs` after the window started.
  // Returns the cue brightness to flash right now, or 0.
  uint8_t onSample(uint32_t elapsedMs, uint16_t raw) {
    const uint8_t cue = closeBinsUntil(elapsedMs);
    const Movement movement = detector_.addSample(raw);
    tracker_.addSample(detector_.signalOk(), movement);
    return cue;
  }

  // Call when sampling resumes after a pause (e.g. once the cue has finished flashing)
  void onResume() { detector_.reset(); }

  // Call at the end of the window to record the last partial epoch
  void finish(uint32_t elapsedMs) {
    closeBinsUntil(elapsedMs);
    if (binsInEpoch_ > 0) {
      pushEpoch();
    }
  }

  const NightLog& log() const { return log_; }
  uint8_t cueLevel() const { return cues_.level(); }

 private:
  uint8_t closeBinsUntil(uint32_t elapsedMs) {
    uint8_t cue = 0;
    while (elapsedMs >= (binsClosed_ + 1) * BIN_MS && log_.epochCount < MAX_EPOCHS) {
      const BinSummary bin = tracker_.closeBin();
      binsClosed_++;

      const uint16_t moves = epoch_.eyeMoves + bin.eyeMoves;
      epoch_.eyeMoves = moves > 255 ? 255 : (uint8_t)moves;
      if (bin.bodyMovement) epoch_.flags |= EPOCH_BODY;
      if (bin.remLike) epoch_.flags |= EPOCH_REM;
      if (bin.badSignal) epoch_.flags |= EPOCH_BAD_SIGNAL;

      const uint32_t nowSec = binsClosed_ * BIN_MS / 1000;
      cues_.observe(nowSec, bin.bodyMovement);
      if (log_.cueCount > 0 && log_.cues[log_.cueCount - 1].outcome == CueOutcome::Pending) {
        log_.cues[log_.cueCount - 1].outcome = cues_.lastOutcome();
      }
      const uint8_t level = cues_.maybeCue(nowSec, tracker_.remSustained());
      if (level > 0) {
        cue = level;
        epoch_.flags |= EPOCH_CUE;
        if (log_.cueCount < MAX_CUE_EVENTS) {
          log_.cues[log_.cueCount++] = CueEvent{log_.epochCount, level, CueOutcome::Pending};
        }
      }
      log_.endLevel = cues_.level();

      if (++binsInEpoch_ == BINS_PER_EPOCH) {
        pushEpoch();
      }
    }
    return cue;
  }

  void pushEpoch() {
    if (log_.epochCount < MAX_EPOCHS) {
      log_.epochs[log_.epochCount++] = epoch_;
    }
    epoch_ = EpochRecord{0, 0};
    binsInEpoch_ = 0;
  }

  uint32_t windowMs_ = 0;
  MovementDetector detector_;
  RemTracker tracker_;
  CueController cues_;
  NightLog log_;
  uint32_t binsClosed_ = 0;
  uint8_t binsInEpoch_ = 0;
  EpochRecord epoch_ = {0, 0};
};

}  // namespace dc
