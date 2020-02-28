import { Ref, watch, ref, computed } from '@vue/composition-api';
import { ScheduledElement, Sequence } from '@/models';
import { addEventListeners } from '@/lib/events';
import { Keys, Disposer } from '@/lib/std';
import { calculateSimpleSnap, slice, doSnap } from '@/utils';
import { SchedulablePrototype } from '@/models/schedulable';
import * as history from '@/core/project/history';
import { getLogger } from '@/lib/log';

const logger = getLogger('grid', { level: 'debug' });

// For more information see the following link:
// https://stackoverflow.com/questions/4270485/drawing-lines-on-html-page
function lineStyle(
  { x1, y1, x2, y2 }: { x1: number, y1: number, x2: number, y2: number },
) {
  const a = x1 - x2;
  const b = y1 - y2;
  const c = Math.sqrt(a * a + b * b);

  const sx = (x1 + x2) / 2;
  const sy = (y1 + y2) / 2;

  const x = sx - c / 2;
  const y = sy;

  const alpha = Math.PI - Math.atan2(-b, a);
  return {
    border: '1px solid white',
    width: c + 'px',
    height: 0,
    transform: 'rotate(' + alpha + 'rad)',
    position: 'absolute',
    top: y + 'px',
    left: x + 'px',
  };
}

type Line = ReturnType<typeof lineStyle>;

type Element = ScheduledElement<any, any, any>;

export type SequencerTool = 'pointer' | 'slicer';

export interface GridOpts<T extends Element> {
  sequence: Sequence<T>;
  pxPerBeat: Ref<number>;
  pxPerRow: Ref<number>;
  snap: Ref<number>;
  minSnap: Ref<number>;
  scrollLeft: Ref<number>;
  scrollTop: Ref<number>;
  beatsPerMeasure: Ref<number>;
  createElement: Ref<undefined | SchedulablePrototype<any, any, any>>;
  getPosition: () => { left: number, top: number };
  tool: Ref<SequencerTool>;
}

export const createGrid = <T extends Element>(
  opts: GridOpts<T>,
) => {
  const { pxPerBeat, pxPerRow, snap, minSnap, scrollLeft, scrollTop, createElement, beatsPerMeasure } = opts;
  let { sequence } = opts;

  // FIXME(Vue3) With Vue 3, we can move to a set I think
  const selected: T[] = [];
  const sDel = (el: T) => {
    const i = selected.indexOf(el);
    if (i === -1) { return; }
    selected.splice(i, 1);
  };

  let holdingShift = false;
  const sequencerLoopEnd = ref(0);
  const disposers = new Set<Disposer>();

  const mousedown = (e: MouseEvent) => {
    const generalDisposer = addEventListeners({
      mousemove: () => {
        disposers.delete(generalDisposer);
        generalDisposer.dispose();
      },
      mouseup: () => {
        generalDisposer.dispose();
        disposers.delete(generalDisposer);
        addElement(e, createElement.value?.copy() as T);
      },
    });

    disposers.add(generalDisposer);

    if (opts.tool.value === 'pointer') {
      selectStart.value = e;
      const disposer = addEventListeners({
        mousemove: (event: MouseEvent) => {
          selectCurrent.value = event;
        },
        mouseup: () => {
          selectStart.value = null;
          selectCurrent.value = null;
          disposers.delete(disposer);
          disposer.dispose();
        },
      });

      disposers.add(disposer);
    } else if (opts.tool.value === 'slicer') {
      const rect = opts.getPosition();

      const calculatePos = (event: MouseEvent) => {
        return {
          x: calculateSimpleSnap({
            value: (event.clientX - rect.left) / pxPerBeat.value,
            altKey: event.altKey,
            minSnap: minSnap.value,
            snap: snap.value,
          }) * pxPerBeat.value,
          y: event.clientY - rect.top,
        };
      };

      const { x: x1, y: y1 } = calculatePos(e);
      const disposer = addEventListeners({
        mousemove: (event) => {
          const { x: x2, y: y2 } = calculatePos(event);
          sliceStyle.value =  {
            zIndex: 3,
            ...lineStyle({ x1, y1, x2, y2 }),
          };
        },
        mouseup: (event) => {
          const { x: x2, y: y2 } = calculatePos(event);

          const toAdd: T[] = [];
          sequence.l.forEach((element) => {
            const result = slice({
              row: element.row.value,
              time: element.time.value,
              duration: element.duration.value,
              pxPerBeat: pxPerBeat.value,
              rowHeight: pxPerRow.value,
              x1,
              y1,
              x2,
              y2,
            });

            if (result.result !== 'slice') {
              return;
            }

            const time = calculateSimpleSnap({
              value: result.time,
              altKey: event.altKey,
              minSnap: minSnap.value,
              snap: snap.value,
            });

            const newEl = element.slice(time);

            if (newEl) {
              toAdd.push(newEl as T);
            }
          });

          sequence.add(...toAdd);
          sliceStyle.value = null;

          disposers.delete(disposer);
          disposer.dispose();
        },
      });

      disposers.add(disposer);
    }
  };

  const checkLoopEnd = () => {
    // Set the minimum to 1 measure!
    const maxTime = Math.max(
      ...sequence.l.map((item) => item.time.value + item.duration.value),
      beatsPerMeasure.value,
    );

    const newLoopEnd = Math.ceil(maxTime / beatsPerMeasure.value) * beatsPerMeasure.value;

    if (newLoopEnd !== sequencerLoopEnd.value) {
      sequencerLoopEnd.value = newLoopEnd;
    }
  };

  // Always call once at the start to initiate the loop end
  checkLoopEnd();

  const displayBeats = computed(() => {
    return Math.max(
      256, // 256 is completely random
      sequencerLoopEnd.value + beatsPerMeasure.value * 2,
    );
  });

  const addElement = (e: MouseEvent, el: T | undefined) => {
    if (!el) {
      return;
    }

    if (selected.length > 0) {
      selected.splice(0, selected.length);
      return;
    }

    const rect = opts.getPosition();
    const time = doSnap({
      position: e.clientX,
      minSnap: minSnap.value,
      snap: snap.value,
      pxPerBeat: pxPerBeat.value,
      offset: rect.left,
      scroll: scrollLeft.value,
      altKey: e.altKey,
    });

    const row = doSnap({
      position: e.clientY,
      minSnap: 1,
      snap: 1,
      pxPerBeat: pxPerRow.value,
      offset: rect.top,
      scroll: scrollTop.value,
      altKey: false, // irrelevant
    });

    el.row.value = row;
    el.time.value = time;

    opts.sequence.add(el);
    checkLoopEnd();

    return el;
  };

  let initialMoveBeat: undefined | number;
  const move = (i: number, e: MouseEvent) => {
    if (initialMoveBeat === undefined) {
      return;
    }

    const el = sequence.l[i];
    const rect = opts.getPosition();

    const time = doSnap({
      position: e.clientX,
      offset: rect.left,
      scroll: scrollLeft.value,
      altKey: e.altKey,
      snap: snap.value,
      minSnap: minSnap.value,
      pxPerBeat: pxPerBeat.value,
    });

    const row = doSnap({
      position: e.clientY,
      offset: rect.top,
      scroll: scrollTop.value,
      altKey: false, // irrelevant
      snap: 1,
      minSnap: 1,
      pxPerBeat: pxPerRow.value,
    });


    const timeDiff = time - initialMoveBeat;
    const rowDiff = row - el.row.value;

    if (timeDiff === 0 && rowDiff === 0) {
      return;
    }

    let itemsToMove: readonly T[];
    if (selected.includes(el)) {
      itemsToMove = selected;
    } else {
      itemsToMove = [el];
    }

    const canMoveTime = itemsToMove.every((item) => item.time.value + timeDiff >= 0);
    const canMoveRow = itemsToMove.every((item) => item.row.value + rowDiff >= 0);

    if (!canMoveRow && !canMoveTime) {
      return;
    }

    const doMove = (o: { timeDiff: number, rowDiff: number }) => {
      if (canMoveTime) {
        // TODO is this a bug?
        initialMoveBeat = time;
        itemsToMove.forEach((item) => {
          item.time.value += o.timeDiff;
        });

        checkLoopEnd();
      }

      if (canMoveRow) {
        itemsToMove.forEach((item) => {
          item.row.value = item.row.value + o.rowDiff;
        });
      }
    };

    history.execute({
      execute: () => {
        doMove({ timeDiff, rowDiff });
      },
      undo: () => {
        doMove({ timeDiff: -timeDiff, rowDiff: -rowDiff });
      },
    });
  };

  const updateAttr = (i: number, value: number, attr: 'offset' | 'duration') => {
    const el = sequence.l[i];
    const diff = value - el[attr].value;

    let toUpdate: readonly T[];
    if (selected.includes(el)) {
      toUpdate = selected;
    } else {
      toUpdate = [el];
    }

    // If the diff is less than zero, make sure we aren't setting the offset of
    // any of the elements to < 0
    if (diff < 0 && toUpdate.some((element) => (element[attr].value + diff) < 0)) {
      return;
    }

    toUpdate.forEach((element) => {
      element[attr].value += diff;
    });
  };

  const select = (e: MouseEvent, i: number) => {
    const item = sequence.l[i];
    const elIsSelected = selected.includes(item);

    if (!elIsSelected) {
      selected.splice(0, selected.length);
    }

    const createItem = (oldItem: T, addToSelected: boolean) => {
      const newItem = oldItem.copy();

      // We set selected to true because `newNew` will have a higher z-index
      // Thus, it will be displayed on top (which we want)
      // Try copying selected files and you will notice the selected notes stay on top
      if (addToSelected) {
        selected.push(newItem as T);
      }

      sequence.add(newItem as T);
    };

    if (holdingShift) {
      // If selected, copy all selected. If not, just copy the item that was clicked.
      if (elIsSelected) {
        // selected is all all selected except the element you pressed on
        selected.forEach((el) => {
          if (el === item) {
            // A copy of `item` will be created at this index which becomes the target for moving
            i = sequence.l.length;
          }

          // Set old item selected -> false and new item selected -> true since
          // the new items will be placed over the old elements
          sDel(el);
          createItem(el, true);
        });
      } else {
        i = sequence.l.length;
        createItem(item, false);
      }
    }

    document.documentElement.style.cursor = 'move';
    const rect = opts.getPosition();
    initialMoveBeat = doSnap({
      position: e.clientX,
      offset: rect.left,
      scroll: scrollLeft.value,
      altKey: e.altKey,
      snap: snap.value,
      minSnap: minSnap.value,
      pxPerBeat: pxPerBeat.value,
    });

    const disposer = addEventListeners({
      mousemove: (event) => move(i, event),
      mouseup: () => {
        document.documentElement.style.cursor = 'auto';
        initialMoveBeat = undefined;
        disposer.dispose();
        disposers.delete(disposer);
      },
    });

    disposers.add(disposer);
  };

  const onMounted = () => {
    disposers.add(addEventListeners({
      keydown: (e) => {
        if (e.keyCode === Keys.Shift) {
          holdingShift = true;
        } else if (e.keyCode === Keys.Delete || e.keyCode === Keys.Backspace) {
          for (const el of selected) {
            const i = sequence.l.indexOf(el);
            if (i === -1) {
              continue;
            }

            removeAtIndex(i);
          }
        }
      },
      keyup: (e) => {
        if (e.keyCode === Keys.Shift) {
          holdingShift = false;
        }
      },
    }));
  };

  const removeAtIndex = (i: number) => {
    const el = sequence.l[i];
    el.remove();
  };

  const remove = (i: number, e: MouseEvent) => {
    e.preventDefault();
    removeAtIndex(i);
  };

  const dispose = () => {
    disposers.forEach((disposer) => {
      disposer.dispose();
    });

    disposers.clear();
  };

  const selectStart = ref<MouseEvent>(null);
  const selectCurrent = ref<MouseEvent>(null);
  const sliceStyle = ref<Line & { zIndex: number }>(null);

  const selectStyle = computed(() => {
    if (!selectStart.value) { return; }
    if (!selectCurrent.value) {
      selected.splice(0, selected.length);
      return;
    }

    const rect = opts.getPosition();
    const left = Math.min(
      selectStart.value.clientX - rect.left + scrollLeft.value,
      selectCurrent.value.clientX - rect.left + scrollLeft.value,
    );

    const top = Math.min(
      selectStart.value.clientY - rect.top + scrollTop.value,
      selectCurrent.value.clientY - rect.top + scrollTop.value,
    );

    const width = Math.abs(selectCurrent.value.clientX - selectStart.value.clientX);
    const height = Math.abs(selectCurrent.value.clientY - selectStart.value.clientY);

    // these are exact numbers BTW, not integers
    const minBeat = left / pxPerBeat.value;
    const minRow = top / pxPerRow.value;
    const maxBeat = (left + width) / pxPerBeat.value;
    const maxRow = (top + height) / pxPerRow.value;

    sequence.l.forEach((item) => {
      // Check if there is any overlap between the rectangles
      // https://www.geeksforgeeks.org/find-two-rectangles-overlap/
      if (minRow > item.row.value + 1 || item.row.value > maxRow) {
        sDel(item);
      } else if (minBeat > item.time.value + item.duration.value || item.time.value > maxBeat) {
        sDel(item);
      } else {
        if (!selected.includes(item)) {
          selected.push(item);
        }
      }
    });

    logger.debug('There are ' + selected.length + ' selected elements!');

    return {
      borderRadius: '5px',
      border: 'solid 1px red',
      backgroundColor: 'rgba(255, 51, 51, 0.3)',
      left: `${left}px`,
      top: `${top}px`,
      height: `${height}px`,
      width: `${width}px`,
      zIndex: 3,
    };
  });

  return {
    selectStyle,
    sliceStyle,
    selected,
    move,
    updateOffset(i: number, value: number) {
      updateAttr(i, value, 'offset');
    },
    updateDuration(i: number, value: number) {
      updateAttr(i, value, 'duration');

      // Make sure to check the loop end when the duration of an element has been changed!!
      checkLoopEnd();
    },
    remove,
    select,
    sequencerLoopEnd,
    displayBeats,
    onMounted,
    onUnmounted: dispose,
    dispose,
    add: (e: MouseEvent) => {
      return addElement(e, createElement.value?.copy() as T);
    },
    mousedown,
    setSequence(s: Sequence<T>) {
      sequence = s;
      selected.splice(0, selected.length);
      checkLoopEnd();
    },
  };
};