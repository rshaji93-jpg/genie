"use client";

type CricketState = Record<string, unknown> & {
  picks?: Record<string, number>;
  runs?: number;
  round?: number;
  out?: boolean;
};

export default function HandCricketGame({
  state,
  playerId,
  onStateChange,
}: {
  state: CricketState;
  playerId: string;
  onStateChange: (next: Record<string, unknown>) => void;
}) {
  const picks = state.picks || {};
  const otherPick = Object.entries(picks).find(([id]) => id !== playerId)?.[1];
  const myPick = picks[playerId];
  return (
    <section className="rounded-xl border border-sky-200 bg-sky-50 p-3">
      <strong>Hand Cricket</strong>
      <p className="my-2 text-sm">Pick 1–6. Matching the other player’s number is an out.</p>
      <div className="flex flex-wrap gap-2">
        {[1, 2, 3, 4, 5, 6].map((number) => (
          <button
            aria-pressed={myPick === number}
            className="rounded-lg border bg-white px-4 py-2 font-semibold"
            key={number}
            onClick={() => {
              const nextPicks = { ...picks, [playerId]: number };
              const selectedPicks = Object.values(nextPicks);
              const resolved = selectedPicks.length >= 2;
              onStateChange({
                picks: resolved ? {} : nextPicks,
                runs: (state.runs || 0) + (resolved && selectedPicks[0] !== selectedPicks[1] ? selectedPicks[0] + selectedPicks[1] : 0),
                round: (state.round || 0) + (resolved ? 1 : 0),
                out: resolved && selectedPicks[0] === selectedPicks[1],
                lastPicks: resolved ? selectedPicks : [],
              });
            }}
            type="button"
          >{number}</button>
        ))}
      </div>
      <p className="mt-2 text-sm">
        {myPick ? `Your pick: ${myPick}. ` : ""}
        {otherPick ? "Waiting for your pick…" : "Waiting for the other player…"}
        {state.out ? " · Out!" : ""}
        {` · Runs: ${state.runs || 0}`}
      </p>
    </section>
  );
}
