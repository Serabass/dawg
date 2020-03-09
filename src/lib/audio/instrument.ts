import { Note, ContextTime, Seconds, NormalRange } from '@/lib/audio/types';
import { context } from '@/lib/audio/online';

export interface ObeoInstrument {
  triggerAttackRelease(note: Note, duration: Seconds, time?: ContextTime, velocity?: NormalRange): void;
  triggerAttack(note: Note, time?: ContextTime, velocity?: NormalRange): Releaser;
}

export interface Releaser {
  triggerRelease(time?: ContextTime): void;
}

export interface InstrumentOptions {
  triggerAttack(note: Note, time?: ContextTime, velocity?: NormalRange): Releaser;
}

export const createInstrument = ({ triggerAttack }: InstrumentOptions) => {
  const triggerAttackRelease = (note: Note, duration: Seconds, time?: ContextTime, velocity?: NormalRange) => {
    time = time ?? context.now();
    const releaser = triggerAttack(note, time, velocity);
    releaser.triggerRelease(time + duration);
  };

  return {
    triggerAttackRelease,
    triggerAttack,
  };
};