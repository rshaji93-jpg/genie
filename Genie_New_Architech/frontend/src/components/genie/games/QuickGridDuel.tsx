"use client";

type GridMode = "connect-four" | "tic-tac-toe";

function findWinner(cells: string[], mode: GridMode): string | null {
  const width = mode === "connect-four" ? 7 : 3;
  const height = mode === "connect-four" ? 6 : 3;
  const target = mode === "connect-four" ? 4 : 3;
  for (let row = 0; row < height; row += 1) {
    for (let column = 0; column < width; column += 1) {
      const mark = cells[row * width + column];
      if (!mark) continue;
      for (const [rowStep, columnStep] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
        let matched = true;
        for (let step = 1; step < target; step += 1) {
          const nextRow = row + rowStep * step;
          const nextColumn = column + columnStep * step;
          if (
            nextRow < 0 || nextRow >= height || nextColumn < 0 || nextColumn >= width
            || cells[nextRow * width + nextColumn] !== mark
          ) {
            matched = false;
            break;
          }
        }
        if (matched) return mark;
      }
    }
  }
  return null;
}

export default function QuickGridDuel({
  state,
  onStateChange,
}: {
  state: Record<string, unknown>;
  onStateChange: (next: Record<string, unknown>) => void;
}) {
  const mode: GridMode = state.mode === "connect-four" ? "connect-four" : "tic-tac-toe";
  const width = mode === "connect-four" ? 7 : 3;
  const height = mode === "connect-four" ? 6 : 3;
  const cells = Array.isArray(state.cells) && state.cells.length === width * height
    ? state.cells as string[]
    : Array(width * height).fill("");
  const mark = typeof state.turn === "string" ? state.turn : "X";
  const winner = findWinner(cells, mode);

  function reset(nextMode: GridMode) {
    const nextWidth = nextMode === "connect-four" ? 7 : 3;
    const nextHeight = nextMode === "connect-four" ? 6 : 3;
    onStateChange({ mode: nextMode, cells: Array(nextWidth * nextHeight).fill(""), turn: "X" });
  }

  return (
    <section className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <strong>Quick Grid Duel</strong>
        <div className="flex gap-2">
          <button className="rounded border bg-white px-2 py-1 text-xs" onClick={() => reset("tic-tac-toe")} type="button">Tic-tac-toe</button>
          <button className="rounded border bg-white px-2 py-1 text-xs" onClick={() => reset("connect-four")} type="button">Connect-4</button>
          <button className="rounded border bg-white px-2 py-1 text-xs" onClick={() => reset(mode)} type="button">Reset</button>
        </div>
      </div>
      <div
        aria-label={mode === "connect-four" ? "Connect-4 board" : "Tic-tac-toe board"}
        className={`grid w-fit gap-1 ${mode === "connect-four" ? "grid-cols-7" : "grid-cols-3"}`}
      >
        {cells.map((cell, index) => (
          <button
            aria-label={`Row ${Math.floor(index / width) + 1}, column ${index % width + 1}${cell ? ` ${cell}` : ""}`}
            className={`h-10 w-10 rounded text-lg font-bold ${mode === "connect-four" ? "rounded-full bg-white" : "bg-white"}`}
            disabled={Boolean(winner) || (mode === "tic-tac-toe" && Boolean(cell))}
            key={index}
            onClick={() => {
              let target = index;
              if (mode === "connect-four") {
                target = -1;
                for (let row = height - 1; row >= 0; row -= 1) {
                  const candidate = row * width + (index % width);
                  if (!cells[candidate]) {
                    target = candidate;
                    break;
                  }
                }
                if (target < 0) return;
              } else if (cell) {
                return;
              }
              const next = [...cells];
              next[target] = mark;
              onStateChange({ mode, cells: next, turn: mark === "X" ? "O" : "X" });
            }}
            type="button"
          >{cell}</button>
        ))}
      </div>
      <p className="mt-2 text-xs">{winner ? `${winner} wins!` : `Turn: ${mark}`}</p>
    </section>
  );
}
