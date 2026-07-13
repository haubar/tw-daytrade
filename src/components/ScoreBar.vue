<script setup>
// ScoreBar.vue — 「因子解剖條」，這個 Dashboard 的簽名元素。
// 把總分拆成四段，讓使用者一眼看出「這檔股票的分數主要是被哪個因子推高的」。
// 四個因子：量能異常／跳空幅度／相對大盤強弱勢／三大法人買賣超
// （法人買賣超是原本規劃「隔日沖分點」因子的替代方案，見 PROGRESS.md）

defineProps({
  volumeContribution: { type: Number, required: true },
  gapContribution: { type: Number, required: true },
  relativeStrengthContribution: { type: Number, required: true },
  institutionalContribution: { type: Number, required: true },
  score: { type: Number, required: true },
  tone: { type: String, required: true, validator: (v) => v === 'surge' || v === 'ebb' },
});

// 四個因子權重合計後，理論最高分是 100（見 factors.mjs 的 computeCompositeScores），
// 用這個當作長條的滿版基準，這樣不同股票之間的長條長度可以直接比較「總分高低」。
const MAX_SCORE = 100;

function pct(value) {
  return `${Math.max(0, Math.min(100, (value / MAX_SCORE) * 100))}%`;
}
</script>

<template>
  <div class="flex min-w-0 items-center gap-2">
    <div
      class="flex h-2.5 min-w-[60px] flex-1 overflow-hidden rounded-sm bg-panel-raised"
      role="img"
      :aria-label="`綜合分數 ${score.toFixed(1)}，其中量能異常貢獻 ${volumeContribution.toFixed(1)}，跳空幅度貢獻 ${gapContribution.toFixed(1)}，相對強弱貢獻 ${relativeStrengthContribution.toFixed(1)}，法人買賣超貢獻 ${institutionalContribution.toFixed(1)}`"
    >
      <span
        class="h-full bg-gold transition-[width] duration-[400ms] motion-reduce:transition-none"
        :style="{ width: pct(volumeContribution) }"
        title="量能異常貢獻"
      />
      <span
        class="h-full transition-[width] duration-[400ms] motion-reduce:transition-none"
        :class="tone === 'surge' ? 'bg-surge' : 'bg-ebb'"
        :style="{ width: pct(gapContribution) }"
        title="跳空幅度貢獻"
      />
      <span
        class="h-full bg-signal transition-[width] duration-[400ms] motion-reduce:transition-none"
        :style="{ width: pct(relativeStrengthContribution) }"
        title="相對大盤強弱勢貢獻"
      />
      <span
        class="h-full bg-crest transition-[width] duration-[400ms] motion-reduce:transition-none"
        :style="{ width: pct(institutionalContribution) }"
        title="三大法人買賣超貢獻"
      />
    </div>
    <span
      class="min-w-[3ch] shrink-0 text-right font-mono text-sm font-semibold"
      :class="tone === 'surge' ? 'text-surge' : 'text-ebb'"
    >
      {{ score.toFixed(1) }}
    </span>
  </div>
</template>
