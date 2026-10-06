// 音声の分割・無音判定(Worker とテストの両方から使う純粋関数)

export const SAMPLE_RATE = 16000;
const WINDOW_S = 30; // Whisper が一度に扱える長さ
const SEARCH_S = 4; // 区切り位置を探す範囲(各窓の終端側)
const FRAME = SAMPLE_RATE / 10; // 0.1秒

// 二乗平均平方根(音量)
export function rms(samples) {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

// 最大30秒ごとの区間 [start, end) に分割する。
// 単語の途中で切れにくいよう、窓の終端の手前4秒のうち最も静かな位置で区切る。
export function splitSegments(audio) {
  const win = WINDOW_S * SAMPLE_RATE;
  const search = SEARCH_S * SAMPLE_RATE;
  const segments = [];
  let start = 0;
  while (start < audio.length) {
    let end = Math.min(start + win, audio.length);
    if (end < audio.length) {
      let bestPos = end;
      let bestEnergy = Infinity;
      for (let p = end - search; p + FRAME <= end; p += FRAME / 2) {
        let e = 0;
        for (let i = p; i < p + FRAME; i++) e += audio[i] * audio[i];
        if (e < bestEnergy) {
          bestEnergy = e;
          bestPos = p + FRAME / 2;
        }
      }
      end = Math.round(bestPos);
    }
    segments.push([start, end]);
    start = end;
  }
  return segments;
}
