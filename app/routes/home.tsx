export function meta() {
  return [
    { title: "BFO" },
    { name: "description", content: "Look, feel and perform your best every day." },
  ];
}

export default function Home() {
  return (
    <div>
      <h1 className="text-2xl sm:text-3xl font-bold">Welcome to BFO</h1>
      <p className="text-gray-400 mt-2">Look, feel and perform your best every day.</p>
    </div>
  );
}
