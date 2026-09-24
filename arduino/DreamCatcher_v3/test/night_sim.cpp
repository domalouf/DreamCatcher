// Tests DreamLogic.h on a computer, using simulated eye sensor signals.
// Run with: ./run_tests.sh
//
// The simulated signals are made up (no real overnight recordings exist yet),
// so these tests check that the logic behaves sensibly - REM found in REM,
// cues spaced out and adapting - not that the thresholds suit a real sensor.

#include "../DreamLogic.h"

#include <cmath>
#include <cstdio>
#include <random>
#include <string>
#include <vector>

using namespace dc;

static int failures = 0;

static void check(bool ok, const std::string& what) {
  printf("  [%s] %s\n", ok ? "PASS" : "FAIL", what.c_str());
  if (!ok) failures++;
}

enum class Stage { NREM, REM, Wake };
static const char* stageName(Stage s) {
  return s == Stage::NREM ? "NREM" : s == Stage::REM ? "REM" : "Wake";
}

// Produces sensor readings for a sleeper: noise, slow drift, eye movements and body movements
class SignalSim {
 public:
  explicit SignalSim(unsigned seed, double noiseSigma = 3.0) : rng_(seed), noiseSigma_(noiseSigma) {}

  double uniform(double lo, double hi) { return std::uniform_real_distribution<double>(lo, hi)(rng_); }
  bool chance(double p) { return uniform(0, 1) < p; }
  double expo(double mean) { return std::exponential_distribution<double>(1.0 / mean)(rng_); }

  // Start a quick eye jump (over two samples)
  void saccade(double amplitude) {
    const double toward = eyeTarget_ > 0 ? -1 : 1;  // eyes tend to come back to the middle
    eyeTarget_ += amplitude * (chance(0.7) ? toward : -toward);
  }

  // Start a head/body movement: the mask shifts on the face, which changes the
  // sensor's distance from the eyelid far more than an eye movement does
  void bodyMovement() {
    bodySamplesLeft_ = (int)uniform(15, 50);
    const double toward = maskOffset_ > 0 ? -1 : 1;  // the mask stays roughly in place overall
    const double shift = uniform(200, 800) * (chance(0.7) ? toward : -toward);
    bodyStep_ = shift / bodySamplesLeft_;
  }

  uint16_t read(double tSec) {
    const double step = (eyeTarget_ - eyePos_) / 2;
    eyePos_ += std::fabs(step) < 0.5 ? eyeTarget_ - eyePos_ : step;
    if (bodySamplesLeft_ > 0) {
      bodySamplesLeft_--;
      maskOffset_ += bodyStep_ + uniform(-15, 15);
    }
    const double drift = 60 * std::sin(2 * M_PI * tSec / 1200) + 8 * std::sin(2 * M_PI * 0.1 * tSec);
    const double value = 2000 + drift + eyePos_ + maskOffset_ +
                         std::normal_distribution<double>(0, noiseSigma_)(rng_);
    return (uint16_t)std::lround(std::fmin(4095, std::fmax(0, value)));
  }

  std::mt19937 rng_;

 private:
  double noiseSigma_;
  double eyePos_ = 0, eyeTarget_ = 0;
  double maskOffset_ = 0, bodyStep_ = 0;
  int bodySamplesLeft_ = 0;
};

// ---- MovementDetector on simple signals ----------------------------------------

static int countMovements(MovementDetector& det, SignalSim& sim, int samples, Movement kind,
                          const std::vector<int>& saccadeAt, double saccadeSize,
                          const std::vector<int>& bodyAt) {
  int count = 0;
  size_t nextSaccade = 0, nextBody = 0;
  for (int i = 0; i < samples; i++) {
    if (nextSaccade < saccadeAt.size() && saccadeAt[nextSaccade] == i) {
      sim.saccade(saccadeSize);
      nextSaccade++;
    }
    if (nextBody < bodyAt.size() && bodyAt[nextBody] == i) {
      sim.bodyMovement();
      nextBody++;
    }
    if (det.addSample(sim.read(i * SAMPLE_MS / 1000.0)) == kind) count++;
  }
  return count;
}

static void testMovementDetector() {
  printf("MovementDetector\n");
  const int hour = 3600 * 1000 / SAMPLE_MS;

  for (uint8_t sens = 1; sens <= 5; sens++) {
    SignalSim sim(100 + sens);
    MovementDetector det(sens);
    const int falseEye = countMovements(det, sim, hour, Movement::Eye, {}, 0, {});
    const int limit = sens <= 3 ? 5 : (sens == 4 ? 20 : 60);
    check(falseEye <= limit, "sensitivity " + std::to_string(sens) + ": " +
                                 std::to_string(falseEye) + " false eye movements in an hour of noise (limit " +
                                 std::to_string(limit) + ")");
  }

  std::vector<int> saccades;
  for (int i = 0; i < 200; i++) saccades.push_back(100 + i * 75);  // one every 3 s
  {
    SignalSim sim(7);
    MovementDetector det(3);
    const int found = countMovements(det, sim, 100 + 200 * 75, Movement::Eye, saccades, 35, {});
    check(found >= 180, std::to_string(found) + "/200 eye movements of 35 counts detected (noise sd 3)");
  }
  {
    SignalSim sim(7);
    MovementDetector det(3);
    const int body = countMovements(det, sim, 100 + 200 * 75, Movement::Body, saccades, 35, {});
    check(body == 0, std::to_string(body) + " eye movements mistaken for body movements");
  }

  std::vector<int> bodies;
  for (int i = 0; i < 40; i++) bodies.push_back(100 + i * 500);  // one every 20 s
  {
    SignalSim sim(8);
    MovementDetector det(3);
    const int body = countMovements(det, sim, 100 + 40 * 500, Movement::Body, {}, 0, bodies);
    check(body >= 36 && body <= 44, std::to_string(body) + "/40 body movements detected");
  }
  {
    SignalSim sim(8);
    MovementDetector det(3);
    const int eye = countMovements(det, sim, 100 + 40 * 500, Movement::Eye, {}, 0, bodies);
    check(eye <= 8, std::to_string(eye) + " body movements mistaken for eye movements");
  }

  {
    MovementDetector det(3);
    SignalSim sim(9);
    int body = 0;
    for (int i = 0; i < 200; i++) det.addSample(sim.read(i * 0.04));
    for (int i = 0; i < 100; i++) body += det.addSample(4095) == Movement::Body;
    check(body == 1 && !det.signalOk(), "a saturated sensor reports one body movement and a bad signal");
  }
}

// ---- Whole nights ----------------------------------------------------------------

struct NightStats {
  int epochs[3] = {};         // epochs per true stage
  int remFlagged[3] = {};     // epochs flagged REM per true stage
  int cues[3] = {};           // cues delivered per true stage
  int wokeByCue = 0;          // cues that really woke the simulated sleeper
  int wokeDetected = 0;       // ...that the mask also noticed
  int noReactionDetected = 0; // cues slept through that the mask also judged as slept through
  int sleptThrough = 0;
  bool spacingOk = true;
  bool adaptationOk = true;
  int cueCount = 0;
};

// Simulates one night in the dream window and runs the mask logic over it
static NightStats simulateNight(unsigned seed, const Settings& settings, uint32_t windowSec, bool verbose) {
  SignalSim sim(seed);
  NightSession session;
  session.begin(settings, 1790000000, windowSec);

  Stage stage = Stage::NREM;
  double stageLeft = sim.uniform(20, 50) * 60;  // start part-way through non-REM
  bool phasic = true;                           // REM alternates bursts of eye movements with quiet
  double phaseLeft = 0;
  double nextEye = 0, nextBody = sim.expo(1800);
  int burstLeft = 0;
  double wakeFromCueAt = -1;  // when a cue that woke the sleeper takes effect

  std::vector<Stage> sampleStage;
  std::vector<uint32_t> cueSec;
  std::vector<uint8_t> cueLevels;
  std::vector<bool> cueWoke;

  const double dt = SAMPLE_MS / 1000.0;
  uint32_t elapsedMs = 0;
  while (!session.finished(elapsedMs)) {
    const double t = elapsedMs / 1000.0;

    // Move through the sleep cycle
    stageLeft -= dt;
    if (wakeFromCueAt >= 0 && t >= wakeFromCueAt) {
      stage = Stage::Wake;
      stageLeft = sim.uniform(60, 180);
      sim.bodyMovement();
      nextBody = t + sim.expo(25);
      wakeFromCueAt = -1;
    } else if (stageLeft <= 0) {
      if (stage == Stage::NREM) {
        stage = Stage::REM;
        stageLeft = sim.uniform(15, 35) * 60;
        phasic = true;
        phaseLeft = sim.uniform(40, 150);
      } else if (stage == Stage::REM && sim.chance(0.3)) {
        stage = Stage::Wake;
        stageLeft = sim.uniform(60, 180);
        sim.bodyMovement();
      } else {
        stage = Stage::NREM;
        stageLeft = sim.uniform(50, 75) * 60;
        sim.bodyMovement();  // people often shift position between cycles
      }
      nextEye = t + 1;
      nextBody = t + (stage == Stage::Wake ? sim.expo(25) : stage == Stage::NREM ? sim.expo(1800) : 1e9);
    }

    // Eye and body movements for the current stage
    if (stage == Stage::REM) {
      phaseLeft -= dt;
      if (phaseLeft <= 0) {
        phasic = !phasic;
        phaseLeft = phasic ? sim.uniform(40, 150) : sim.uniform(20, 90);
      }
      if (t >= nextEye) {
        if (burstLeft == 0) burstLeft = phasic ? (int)sim.uniform(1, 5) : 1;
        sim.saccade(sim.uniform(20, 60));
        burstLeft--;
        nextEye = t + (burstLeft > 0 ? sim.uniform(0.2, 0.5) : (phasic ? sim.expo(5) : sim.expo(20)));
      }
    } else if (stage == Stage::Wake) {
      if (t >= nextEye) {
        sim.saccade(sim.uniform(20, 80));
        nextEye = t + sim.expo(3);
      }
    } else if (t >= nextEye) {
      sim.saccade(sim.uniform(10, 20));  // occasional small twitch
      nextEye = t + sim.expo(300);
    }
    if (t >= nextBody) {
      sim.bodyMovement();
      nextBody = t + (stage == Stage::Wake ? sim.expo(25) : stage == Stage::NREM ? sim.expo(1800) : 1e9);
    }

    const uint8_t cue = session.onSample(elapsedMs, sim.read(t));
    sampleStage.push_back(stage);
    if (cue > 0) {
      // Brighter cues are more likely to wake the sleeper
      const bool wakes = stage == Stage::REM && sim.chance(std::fmin(0.9, cue / 110.0));
      cueSec.push_back(elapsedMs / 1000);
      cueLevels.push_back(cue);
      cueWoke.push_back(wakes);
      if (wakes) wakeFromCueAt = t + sim.uniform(5, 20);
      if (verbose) {
        printf("    %5.1f min  cue at %3d%% during %s%s\n", t / 60, cue, stageName(stage),
               wakes ? " -> wakes up" : "");
      }
      // The cue takes ~4.5 s, during which no readings are taken
      for (int i = 0; i < 4500 / (int)SAMPLE_MS; i++) {
        elapsedMs += SAMPLE_MS;
        sim.read(elapsedMs / 1000.0);
        sampleStage.push_back(stage);
      }
      session.onResume();
    }
    elapsedMs += SAMPLE_MS;
  }
  session.finish(elapsedMs);

  // Compare the log with what really happened
  NightStats stats;
  const NightLog& log = session.log();
  const size_t perEpoch = EPOCH_SEC * 1000 / SAMPLE_MS;
  for (uint16_t e = 0; e < log.epochCount; e++) {
    int counts[3] = {};
    for (size_t i = e * perEpoch; i < (e + 1) * perEpoch && i < sampleStage.size(); i++) {
      counts[(int)sampleStage[i]]++;
    }
    const int truth = counts[0] >= counts[1] && counts[0] >= counts[2] ? 0 : (counts[1] >= counts[2] ? 1 : 2);
    stats.epochs[truth]++;
    if (log.epochs[e].flags & EPOCH_REM) stats.remFlagged[truth]++;
  }

  stats.cueCount = log.cueCount;
  for (size_t i = 0; i < cueSec.size(); i++) {
    const size_t sample = (size_t)cueSec[i] * 1000 / SAMPLE_MS;
    stats.cues[(int)sampleStage[sample < sampleStage.size() ? sample : sampleStage.size() - 1]]++;
    if (i > 0 && cueSec[i] - cueSec[i - 1] < settings.cueCooldownSec) stats.spacingOk = false;
    if (i < log.cueCount) {
      const CueOutcome outcome = log.cues[i].outcome;
      if (cueWoke[i]) {
        stats.wokeByCue++;
        if (outcome == CueOutcome::Woke) stats.wokeDetected++;
      } else if (sampleStage[sample < sampleStage.size() ? sample : 0] == Stage::REM) {
        stats.sleptThrough++;
        if (outcome == CueOutcome::NoReaction) stats.noReactionDetected++;
      }
      if (i + 1 < cueLevels.size()) {
        if (outcome == CueOutcome::Woke && cueLevels[i + 1] > cueLevels[i]) stats.adaptationOk = false;
        if (outcome == CueOutcome::NoReaction && cueLevels[i + 1] < cueLevels[i]) stats.adaptationOk = false;
      }
    }
  }
  return stats;
}

static void testNights() {
  printf("Simulated nights (5 hour window, 40 nights)\n");
  Settings settings;
  NightStats total;
  bool spacingOk = true, adaptationOk = true, maxOk = true;
  const int nights = 40;
  for (int n = 0; n < nights; n++) {
    const bool verbose = n == 0;
    if (verbose) printf("  Night 1 cues:\n");
    const NightStats s = simulateNight(1000 + n, settings, 5 * 3600, verbose);
    for (int i = 0; i < 3; i++) {
      total.epochs[i] += s.epochs[i];
      total.remFlagged[i] += s.remFlagged[i];
      total.cues[i] += s.cues[i];
    }
    total.wokeByCue += s.wokeByCue;
    total.wokeDetected += s.wokeDetected;
    total.sleptThrough += s.sleptThrough;
    total.noReactionDetected += s.noReactionDetected;
    total.cueCount += s.cueCount;
    spacingOk = spacingOk && s.spacingOk;
    adaptationOk = adaptationOk && s.adaptationOk;
    maxOk = maxOk && s.cueCount <= settings.maxCues;
  }

  auto pct = [](int a, int b) { return b == 0 ? 0.0 : 100.0 * a / b; };
  const double remHit = pct(total.remFlagged[1], total.epochs[1]);
  const double nremFalse = pct(total.remFlagged[0], total.epochs[0]);
  const double wakeFalse = pct(total.remFlagged[2], total.epochs[2]);
  const int allCues = total.cues[0] + total.cues[1] + total.cues[2];
  printf("  REM epochs flagged as REM:  %5.1f%%  (%d epochs)\n", remHit, total.epochs[1]);
  printf("  NREM epochs flagged as REM: %5.1f%%  (%d epochs)\n", nremFalse, total.epochs[0]);
  printf("  Wake epochs flagged as REM: %5.1f%%  (%d epochs)\n", wakeFalse, total.epochs[2]);
  printf("  Cues: %d in REM, %d in NREM, %d while awake (%.1f per night)\n", total.cues[1], total.cues[0],
         total.cues[2], (double)allCues / nights);
  printf("  Cues that woke the sleeper: %d, recognised by the mask: %d\n", total.wokeByCue, total.wokeDetected);
  printf("  Cues slept through: %d, recognised by the mask: %d\n", total.sleptThrough, total.noReactionDetected);

  check(remHit >= 40, "at least 40% of REM epochs are recognised");
  check(nremFalse <= 2, "at most 2% of non-REM epochs are mistaken for REM");
  check(wakeFalse <= 10, "at most 10% of awake epochs are mistaken for REM");
  check(allCues > 0 && pct(total.cues[1], allCues) >= 90, "at least 90% of cues happen during REM");
  check(spacingOk, "cues are always at least the cooldown apart");
  check(maxOk, "never more than maxCues cues in a night");
  check(adaptationOk, "the next cue is dimmer after waking the sleeper and brighter after being slept through");
  check(pct(total.wokeDetected, total.wokeByCue) >= 80, "at least 80% of cues that woke the sleeper are recognised");
  check(pct(total.noReactionDetected, total.sleptThrough) >= 80,
        "at least 80% of cues that were slept through are recognised");
}

static void testCueController() {
  printf("CueController\n");
  Settings settings;
  settings.cueLevel = 50;
  settings.cueCooldownSec = 300;
  settings.maxCues = 3;
  CueController cues;
  cues.begin(settings);

  cues.observe(10, false);
  check(cues.maybeCue(10, false) == 0, "no cue without sustained REM");
  cues.observe(20, false);
  check(cues.maybeCue(20, true) == 50, "cues at the configured brightness");
  cues.observe(30, true);
  check(cues.lastOutcome() == CueOutcome::Woke && cues.level() == 35, "moving after a cue dims the next one");
  cues.observe(400, false);
  check(cues.maybeCue(400, true) == 0, "waits twice the cooldown after waking the sleeper");
  cues.observe(620, false);
  check(cues.maybeCue(620, true) == 35, "cues again after the longer wait");
  cues.observe(690, false);
  check(cues.lastOutcome() == CueOutcome::NoReaction && cues.level() == 40,
        "sleeping through a cue brightens the next one");
  cues.observe(920, false);
  check(cues.maybeCue(920, true) == 40, "third cue");
  cues.observe(1300, false);
  check(cues.maybeCue(1300, true) == 0, "stops at maxCues");

  // Quick cooldown: the reaction to one cue is judged before the next cue is given
  settings.cueCooldownSec = 30;
  settings.maxCues = 10;
  NightSession session;
  session.begin(settings, 0, 3600);
  check(session.log().startLevel == 50, "night log records the starting brightness");
}

int main() {
  testMovementDetector();
  testCueController();
  testNights();
  printf(failures == 0 ? "\nAll tests passed\n" : "\n%d test(s) FAILED\n", failures);
  return failures == 0 ? 0 : 1;
}
