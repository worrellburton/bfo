import { redirect } from "react-router";
import type { Route } from "./+types/home";
import { isAuthenticated } from "../session.server";

export function meta() {
  return [
    { title: "BFO - Weight tailored to you" },
    { name: "description", content: "Look, feel and perform your best every day." },
  ];
}

export async function loader({ request }: Route.LoaderArgs) {
  if (!(await isAuthenticated(request))) {
    throw redirect("/login");
  }
  return {};
}

const heroCards = [
  {
    title: "Personalized\nGLP-1 Treatments",
    subtitle: "for weight loss",
    bg: "from-emerald-700 to-green-500",
    cta: "LEARN MORE",
  },
  {
    title: "Sermorelin",
    subtitle: "for muscle support",
    bg: "from-amber-700 to-orange-400",
    cta: "LEARN MORE",
  },
  {
    title: "NAD+",
    subtitle: "for energy and\nlongevity",
    bg: "from-sky-600 to-blue-400",
    cta: "LEARN MORE",
  },
];

const smallCards = [
  { title: "MIC+B12", subtitle: "for mood\nand energy" },
  { title: "Hormone Therapy", subtitle: "for women" },
  { title: "Glutathione", subtitle: "for antioxidant\nsupport" },
  { title: "Skin Care", subtitle: "with NAD+" },
];

const trustBadges = [
  "127,000+ members",
  "No surprises, upfront pricing",
  "Personalized support",
  "100% entirely online",
  "FSA & HSA eligible",
  "Free & discreet shipping with all plans",
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Navigation */}
      <nav className="flex items-center justify-between px-8 py-4 border-b border-gray-100">
        <div className="flex items-center gap-10">
          <span className="text-2xl font-bold tracking-tight">BFO</span>
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-gray-700">
            <a href="#" className="hover:text-black">Weight Loss</a>
            <a href="#" className="hover:text-black">Strength</a>
            <a href="#" className="hover:text-black">Anti-Aging</a>
            <a href="#" className="hover:text-black">Hair Growth</a>
            <a href="#" className="hover:text-black">Mood</a>
            <a href="#" className="hover:text-black">More</a>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="bg-black text-white text-sm font-medium px-6 py-2.5 rounded-full hover:bg-gray-800 transition-colors">
            Get started
          </button>
          <button className="border border-gray-300 text-sm font-medium px-6 py-2.5 rounded-full hover:bg-gray-50 transition-colors">
            Login
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="px-8 py-16 max-w-7xl mx-auto">
        <div className="flex flex-col lg:flex-row justify-between items-start gap-8 mb-4">
          <div>
            <h1 className="text-6xl lg:text-7xl font-bold leading-tight tracking-tight">
              Weight<br />tailored to you
            </h1>
            <p className="text-xl text-gray-500 mt-6">
              Look, feel and perform your best every day.
            </p>
          </div>
          <div className="flex flex-col gap-4 text-sm text-gray-700 mt-4 lg:mt-8">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" /></svg>
              <span>127,000+ members</span>
            </div>
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" /></svg>
              <span>Free expedited shipping</span>
            </div>
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              <span>FSA & HSA eligible with all plans</span>
            </div>
          </div>
        </div>
      </section>

      {/* Large Product Cards */}
      <section className="px-8 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {heroCards.map((card) => (
            <div
              key={card.title}
              className={`relative bg-gradient-to-br ${card.bg} rounded-2xl p-8 min-h-[360px] flex flex-col justify-between text-white overflow-hidden`}
            >
              <div>
                <h3 className="text-2xl font-bold whitespace-pre-line leading-tight">
                  {card.title}
                </h3>
                <p className="text-white/80 text-sm mt-1 whitespace-pre-line">{card.subtitle}</p>
              </div>
              <div className="flex items-center gap-2 text-sm font-semibold tracking-wide">
                {card.cta}
                <span className="w-7 h-7 rounded-full border border-white/50 flex items-center justify-center">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                </span>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Small Product Cards */}
      <section className="px-8 py-6 max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {smallCards.map((card) => (
            <div
              key={card.title}
              className="flex items-center justify-between bg-gray-50 rounded-2xl p-6 hover:bg-gray-100 transition-colors cursor-pointer"
            >
              <div>
                <h4 className="text-lg font-bold">{card.title}</h4>
                <p className="text-sm text-gray-500 whitespace-pre-line mt-0.5">{card.subtitle}</p>
              </div>
              <span className="w-9 h-9 rounded-full border border-gray-300 flex items-center justify-center shrink-0 ml-4">
                <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* Trust Bar */}
      <footer className="border-t border-gray-200 mt-8">
        <div className="px-8 py-4 max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-4 text-xs text-gray-500">
          {trustBadges.map((badge) => (
            <span key={badge} className="flex items-center gap-1.5">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
              {badge}
            </span>
          ))}
        </div>
      </footer>
    </div>
  );
}
