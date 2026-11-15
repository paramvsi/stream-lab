import { describe, expect, it } from 'vitest';
import { keyGroupOf, subtaskOf } from './keygroups';

// Golden values printed by Flink 2.2.1 itself (flink-dist jar from the flink:2.2 image):
// KeyGroupRangeAssignment.assignToKeyGroup(k, 128), assignKeyToParallelOperator(k, 128, 2 | 4).
const GOLDEN: [string, number, number, number][] = [
  ['c_4471', 100, 1, 3],
  ['c_2093', 96, 1, 3],
  ['c_7710', 55, 0, 1],
  ['c_2208', 36, 0, 1],
  ['c_9012', 107, 1, 3],
  ['m_101', 30, 0, 0],
  ['m_202', 11, 0, 0],
  ['', 94, 1, 2],
  ['AED', 76, 1, 2],
  ['payment_1234', 122, 1, 3],
];

describe('ENG-03 · key groups match Flink', () => {
  it.each(GOLDEN)('%s → key group %i, subtask %i of 2, %i of 4', (k, kg, p2, p4) => {
    expect(keyGroupOf(k)).toBe(kg);
    expect(subtaskOf(k, 2)).toBe(p2);
    expect(subtaskOf(k, 4)).toBe(p4);
  });
});
