import { useTheme } from "../theme";
import { VQBalanceSheetContent } from "./vq-balance-sheet";

export function meta() {
  return [{ title: "VQ Balance Sheet" }];
}

export default function VQBalanceSheetPublic() {
  // The content follows the theme, so the page around it must too (a light
  // visitor otherwise got white cards on black with white headings on white).
  const { theme } = useTheme();
  const isDark = theme === "dark";
  return (
    <div className={`min-h-screen ${isDark ? "bg-black text-white" : "bg-gray-50 text-gray-900"}`}>
      <div className="max-w-6xl mx-auto px-4 py-6 sm:p-8">
        <VQBalanceSheetContent showShare={false} />
      </div>
    </div>
  );
}
