"use client";

import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { SalesPoint } from "@/lib/queries";

/** Weekly sales with the raw 4-week and 12-week averages. The latest four weeks are shaded. */
export function SalesChart({ data, avg4Raw, avg12Raw }: { data: SalesPoint[]; avg4Raw: number | null; avg12Raw: number | null }) {
  const latestFour = data.slice(-4);
  const summary = `Weekly units sold from ${data[0]?.week} to ${data.at(-1)?.week}`;
  return (
    <div role="img" aria-label={summary} className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 12, right: 72, bottom: 4, left: 0 }}>
          <CartesianGrid stroke="#1e1e1e" vertical={false} />
          {latestFour.length > 0 && <ReferenceArea x1={latestFour[0].week} x2={latestFour.at(-1)?.week} fill="#6798ff" fillOpacity={0.1} />}
          <XAxis dataKey="week" tickFormatter={(w: string) => w.slice(5)} tickLine={false} axisLine={{ stroke: "#313131" }} tick={{ fontSize: 12, fill: "#a7a7a7" }} />
          <YAxis tickLine={false} axisLine={false} width={44} tick={{ fontSize: 12, fill: "#a7a7a7" }} domain={[0, "auto"]} />
          <Tooltip
            formatter={(v) => [`${v} units`, "Sold"]}
            labelFormatter={(w) => `Week ${w}`}
            cursor={{ stroke: "#454545" }}
            contentStyle={{ fontSize: 13, borderRadius: 8, border: "1px solid #313131", boxShadow: "none", background: "#1e1e1e", color: "#ffffff" }}
            labelStyle={{ color: "#a7a7a7" }}
            itemStyle={{ color: "#ffffff" }}
          />
          {avg12Raw !== null && (
            <ReferenceLine y={avg12Raw} stroke="#a7a7a7" strokeDasharray="5 4" label={{ value: "12-wk avg", position: "right", fontSize: 12, fill: "#a7a7a7" }} />
          )}
          {avg4Raw !== null && (
            <ReferenceLine y={avg4Raw} stroke="#6798ff" strokeDasharray="2 3" label={{ value: "4-wk avg", position: "right", fontSize: 12, fill: "#6798ff" }} />
          )}
          <Line type="monotone" dataKey="units" stroke="#ffffff" strokeWidth={1.75} dot={{ r: 3, fill: "#0a0a0a", stroke: "#ffffff", strokeWidth: 1.5 }} activeDot={{ r: 5, fill: "#6798ff", stroke: "#6798ff" }} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
