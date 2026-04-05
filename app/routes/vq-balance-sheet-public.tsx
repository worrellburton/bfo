import { VQBalanceSheetContent } from "./vq-balance-sheet";

export function meta() {
  return [{ title: "VQ Balance Sheet" }];
}

export default function VQBalanceSheetPublic() {
  return (
    <div className="min-h-screen bg-black text-white">
      <div className="max-w-6xl mx-auto p-8">
        <VQBalanceSheetContent showShare={false} />
      </div>
    </div>
  );
}
