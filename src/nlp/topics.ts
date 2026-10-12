// Which of the model's topic labels are kept. Tuned on the hand-labelled evaluation set
// (npm run eval): at most 3 topics with confidence >= 0.85 gave the best precision/recall balance
// (P 82%, R 86%, F1 84%) versus P 70%, R 92% with the earlier 4 topics / 0.5 cutoff.
export const MIN_TOPIC_CONFIDENCE = 0.85;
export const MAX_TOPICS_PER_EPISODE = 3;

export function selectTopics<T extends { confidence: number }>(topics: T[]): T[] {
  return [...topics]
    .sort((a, b) => b.confidence - a.confidence)
    .filter((t) => t.confidence >= MIN_TOPIC_CONFIDENCE)
    .slice(0, MAX_TOPICS_PER_EPISODE);
}
