/**
 * ENG-03 key groups, ported from Flink's KeyGroupRangeAssignment and MathUtils.murmurHash.
 * FLINK: https://github.com/apache/flink/blob/release-2.2/flink-runtime/src/main/java/org/apache/flink/runtime/state/KeyGroupRangeAssignment.java
 * Exact for String keys in the DataStream API (key.hashCode()). Flink SQL hashes BinaryRowData instead, so for
 * SQL jobs the subtask shown here is illustrative.
 */
export const MAX_PARALLELISM = 128;

/** Java String.hashCode (UTF-16 code units, 32-bit overflow). */
export function javaHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}

/** Flink MathUtils.murmurHash(int). */
export function murmur(code: number): number {
  code = Math.imul(code, 0xcc9e2d51);
  code = (code << 15) | (code >>> 17);
  code = Math.imul(code, 0x1b873593);
  code = (code << 13) | (code >>> 19);
  code = (Math.imul(code, 5) + 0xe6546b64) | 0;
  code ^= 4;
  code ^= code >>> 16;
  code = Math.imul(code, 0x85ebca6b);
  code ^= code >>> 13;
  code = Math.imul(code, 0xc2b2ae35);
  code ^= code >>> 16;
  return code >= 0 ? code : code !== -2147483648 ? -code : 0;
}

export const keyGroupOf = (key: string, maxParallelism = MAX_PARALLELISM) =>
  murmur(javaHash(key)) % maxParallelism;

/** Subtask index for a key (computeOperatorIndexForKeyGroup). */
export const subtaskOf = (key: string, parallelism: number, maxParallelism = MAX_PARALLELISM) =>
  Math.floor((keyGroupOf(key, maxParallelism) * parallelism) / maxParallelism);
