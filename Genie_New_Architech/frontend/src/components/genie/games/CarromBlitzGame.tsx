"use client";

import { useEffect, useRef, useState } from "react";

type Coin = { x: number; y: number; color: string; pocketed?: boolean };
type BoardState = Record<string, unknown> & { coins?: Coin[]; score?: number };

const INITIAL_COINS: Coin[] = [
  { x: 200, y: 160, color: "#171717" },
  { x: 180, y: 180, color: "#171717" },
  { x: 220, y: 180, color: "#f7f4ea" },
  { x: 200, y: 200, color: "#d83b45" },
  { x: 180, y: 220, color: "#f7f4ea" },
  { x: 220, y: 220, color: "#171717" },
];

export default function CarromBlitzGame({
  state,
  onStateChange,
}: {
  state: BoardState;
  onStateChange: (next: BoardState) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animationRef = useRef<number | undefined>(undefined);
  const coinsRef = useRef<Coin[]>(state.coins || INITIAL_COINS);
  const strikerRef = useRef({ x: 200, y: 340, vx: 0, vy: 0 });
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const [score, setScore] = useState(state.score || 0);
  const scoreRef = useRef(state.score || 0);

  useEffect(() => {
    coinsRef.current = state.coins || INITIAL_COINS;
    scoreRef.current = state.score || 0;
    setScore(scoreRef.current);
    draw();
  }, [state]);

  useEffect(() => () => {
    if (animationRef.current !== undefined) cancelAnimationFrame(animationRef.current);
  }, []);

  function draw() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#e9c58c";
    context.fillRect(12, 12, 376, 376);
    context.strokeStyle = "#7d5134";
    context.lineWidth = 5;
    context.strokeRect(24, 24, 352, 352);
    context.fillStyle = "#30231b";
    [[34, 34], [366, 34], [34, 366], [366, 366]].forEach(([x, y]) => {
      context.beginPath();
      context.arc(x, y, 14, 0, Math.PI * 2);
      context.fill();
    });
    context.strokeStyle = "#a2714e";
    context.lineWidth = 2;
    context.beginPath();
    context.arc(200, 200, 66, 0, Math.PI * 2);
    context.stroke();
    for (const coin of coinsRef.current) {
      if (coin.pocketed) continue;
      context.beginPath();
      context.fillStyle = coin.color;
      context.arc(coin.x, coin.y, coin.color === "#d83b45" ? 11 : 9, 0, Math.PI * 2);
      context.fill();
      context.strokeStyle = "#6f503c";
      context.stroke();
    }
    const striker = strikerRef.current;
    context.beginPath();
    context.fillStyle = "#fff9ed";
    context.arc(striker.x, striker.y, 14, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = "#165b65";
    context.lineWidth = 3;
    context.stroke();
  }

  function coordinate(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (event.currentTarget.width / rect.width),
      y: (event.clientY - rect.top) * (event.currentTarget.height / rect.height),
    };
  }

  function startFlick() {
    let frames = 0;
    const step = () => {
      const striker = strikerRef.current;
      striker.x += striker.vx;
      striker.y += striker.vy;
      striker.vx *= 0.985;
      striker.vy *= 0.985;
      if (striker.x < 40 || striker.x > 360) striker.vx *= -0.78;
      if (striker.y < 40 || striker.y > 360) striker.vy *= -0.78;
      striker.x = Math.max(40, Math.min(360, striker.x));
      striker.y = Math.max(40, Math.min(360, striker.y));
      for (const coin of coinsRef.current) {
        if (coin.pocketed) continue;
        const dx = coin.x - striker.x;
        const dy = coin.y - striker.y;
        const distance = Math.hypot(dx, dy);
        if (distance < 24 && distance > 0) {
          coin.x += (dx / distance) * 10;
          coin.y += (dy / distance) * 10;
          if (Math.min(coin.x, coin.y, 400 - coin.x, 400 - coin.y) < 24) {
            coin.pocketed = true;
            scoreRef.current += coin.color === "#d83b45" ? 5 : 1;
            setScore(scoreRef.current);
          }
        }
      }
      draw();
      frames += 1;
      if (frames < 90 && (Math.abs(striker.vx) + Math.abs(striker.vy) > 0.18)) {
        animationRef.current = requestAnimationFrame(step);
      } else {
        striker.vx = 0;
        striker.vy = 0;
        animationRef.current = undefined;
        onStateChange({ coins: coinsRef.current, score: scoreRef.current });
      }
    };
    animationRef.current = requestAnimationFrame(step);
  }

  return (
    <section className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <div className="mb-2 flex items-center justify-between"><strong>Carrom Blitz</strong><span>Score: {score}</span></div>
      <canvas
        aria-label="Carrom board. Drag the striker backward and release to flick."
        className="mx-auto w-full max-w-[360px] touch-none rounded-lg"
        height={400}
        onPointerDown={(event) => {
          const point = coordinate(event);
          if (Math.hypot(point.x - strikerRef.current.x, point.y - strikerRef.current.y) < 24) {
            dragStart.current = point;
            event.currentTarget.setPointerCapture(event.pointerId);
          }
        }}
        onPointerUp={(event) => {
          const start = dragStart.current;
          if (!start) return;
          const end = coordinate(event);
          strikerRef.current.vx = Math.max(-12, Math.min(12, (start.x - end.x) * 0.08));
          strikerRef.current.vy = Math.max(-12, Math.min(12, (start.y - end.y) * 0.08));
          dragStart.current = null;
          startFlick();
        }}
        ref={canvasRef}
        width={400}
      />
    </section>
  );
}
