import { useTheme } from "../theme";

export function meta() {
  return [
    { title: "BFO" },
    { name: "description", content: "Look, feel and perform your best every day." },
  ];
}

export default function Home() {
  const { theme } = useTheme();
  const isDark = theme === "dark";

  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold">Welcome to BFO</h1>
      <p className={`${isDark ? "text-gray-400" : "text-gray-500"} mt-2`}>Look, feel and perform your best every day.</p>
    </div>
  );
}
