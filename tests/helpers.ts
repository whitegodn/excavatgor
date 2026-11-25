import { type Command, idleCommand, SIM_HZ } from '../src/core/sim/command';
import { Autopilot } from '../src/equipment/excavator/autopilot';
import { ExcavatorSim } from '../src/equipment/excavator/excavatorSim';
import { TRAINING_YARD } from '../src/sites/site';

export function newSim(): ExcavatorSim {
  return new ExcavatorSim(TRAINING_YARD);
}

export function activeCommand(over: Partial<Command> = {}): Command {
  return { ...idleCommand(), engineOn: true, locked: false, rpm: 10, ...over };
}

/** 시범 운전으로 n사이클을 돌리고, 장비와 입력 기록을 돌려준다. */
export function runAutopilot(cycles = 1, maxSeconds = 120) {
  const sim = newSim();
  const pilot = new Autopilot(cycles);
  const log: Command[] = [];
  const phaseTicks: number[] = [];
  while (!pilot.done && sim.tick < maxSeconds * SIM_HZ) {
    phaseTicks[pilot.phase] = (phaseTicks[pilot.phase] ?? 0) + 1;
    const cmd = pilot.next(sim);
    log.push(cmd);
    sim.step(cmd);
  }
  return { sim, pilot, log, phaseTicks };
}

export function replay(log: readonly Command[]): ExcavatorSim {
  const sim = newSim();
  for (const cmd of log) sim.step(cmd);
  return sim;
}
