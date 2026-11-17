/// <reference lib="webworker" />
// The D18 regex filter, off the UI thread (logFilter.ts kills it past its time limit).
import { answerFilter, type FilterRequest } from './logFilterCore';

self.onmessage = (e: MessageEvent<FilterRequest>) => self.postMessage(answerFilter(e.data));
