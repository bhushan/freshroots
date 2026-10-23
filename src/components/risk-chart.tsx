"use client";

import { Bar, BarChart, Cell, LabelList, ResponsiveContainer, XAxis, YAxis } from "recharts";

export interface RiskDatum {
  name: string;
  value: number;
  color: string;
}

/** Counts per risk state. A SKU can carry several flags, so the bars can add up to more than the SKU total. */
export function RiskChart({ data }: { data: RiskDatum[] }) {
  return (
    <div role="img" aria-label={`Risk distribution: ${data.map((d) => `${d.name} ${d.value}`).join(", ")}`} className="h-[260px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 4, right: 32, bottom: 4, left: 0 }} barCategoryGap={10}>
          <XAxis type="number" hide domain={[0, "dataMax + 1"]} />
          <YAxis type="category" dataKey="name" width={124} tickLine={false} axisLine={false} tick={{ fontSize: 13, fill: "#a7a7a7" }} />
          <Bar dataKey="value" radius={2} isAnimationActive={false} minPointSize={2}>
            {data.map((d) => (
              <Cell key={d.name} fill={d.color} />
            ))}
            <LabelList dataKey="value" position="right" style={{ fontSize: 13, fontWeight: 600, fill: "#ffffff" }} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
