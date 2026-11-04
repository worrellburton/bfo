import { useEffect, useState } from "react";
import { RaceGate } from "../sign/kart";

export function meta() {
  return [{ title: "Kart race (development)" }];
}

/**
 * Development only (app/routes.ts registers it outside production): the
 * racetrack game on sample props, so it can be seen and driven without a
 * signing request. ?auto=1 makes the kart drive itself (engine.ts).
 */
export default function KartDev() {
  const [done, setDone] = useState<"done" | "skipped" | null>(null);
  useEffect(() => {
    document.documentElement.classList.add("dark");
  }, []);
  if (!import.meta.env.DEV) return null;
  if (done)
    return (
      <div className="flex min-h-dvh items-center justify-center bg-black text-white">
        <p data-kart-outcome={done} className="text-[20px]">
          {done === "done" ? "The race handed over to the signing page." : "Skipped to the signing page."}
        </p>
      </div>
    );
  return (
    <div className="min-h-dvh bg-black text-white">
      <RaceGate
        signerName="Sam Elguizaoui"
        title="Operating Agreement - TallulahMD LLC"
        brand={null}
        document={{ fileName: "Operating Agreement - TallulahMD LLC.pdf", pages: 14, sentBy: "Burton Family Office", role: "Member", signPages: [12] }}
        preview
        onDone={() => setDone("done")}
        onSkip={() => setDone("skipped")}
      />
    </div>
  );
}
