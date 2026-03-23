import { useEffect, useState, useRef } from "react";
import { streamChat, callLLM } from "../llm";

export function meta() {
  return [{ title: "BFO - Office" }];
}

interface Agent {
  id: string;
  name: string;
  jobTitle: string;
  model: string;
  systemPrompt: string;
  apiKey: string;
}

interface FileAttachment {
  name: string;
  base64: string;
  mediaType: string;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  file?: FileAttachment;
}

interface AgentPos {
  x: number; y: number;
  targetX: number; targetY: number;
  deskX: number; deskY: number;
  state: "working" | "walking" | "water" | "idle";
  stateTimer: number;
  facing: "left" | "right";
  walkFrame: number;
}

interface Toast {
  id: number;
  text: string;
  agent: string;
}

const FEMALE_NAMES = new Set([
  "mary","patricia","jennifer","linda","barbara","elizabeth","susan","jessica",
  "sarah","karen","lisa","nancy","betty","margaret","sandra","ashley","dorothy",
  "kimberly","emily","donna","michelle","carol","amanda","melissa","deborah",
  "stephanie","rebecca","sharon","laura","cynthia","kathleen","amy","angela",
  "shirley","anna","brenda","pamela","emma","nicole","helen","samantha","katherine",
  "christine","debra","rachel","carolyn","janet","catherine","maria","heather",
  "diane","ruth","julie","olivia","joyce","virginia","victoria","kelly","lauren",
  "christina","joan","evelyn","judith","megan","andrea","cheryl","hannah","jacqueline",
  "martha","gloria","teresa","ann","sara","madison","frances","kathryn","janice",
  "jean","abigail","alice","judy","sophia","grace","denise","amber","doris",
  "marilyn","danielle","beverly","isabella","theresa","diana","natalie","brittany",
  "charlotte","marie","kayla","alexis","lori","chloe","ava","mia","zoe","lily",
  "ella","aria","luna","nora","stella","hazel","violet","aurora","savannah",
  "audrey","brooklyn","bella","claire","skylar","lucy","paisley","everly",
  "caroline","nova","genesis","emilia","kennedy","maya","willow","kinsley","naomi",
  "aaliyah","elena","ariana","allison","gabriella","madelyn","cora",
  "ruby","eva","serenity","autumn","adeline","hailey","gianna","valentina","isla",
  "eliana","quinn","nevaeh","ivy","sadie","piper","lydia","alexa","josephine",
  "emery","julia","delilah","arianna","vivian","kaylee","sophie","brielle","madeline",
  "debbie","tina","jenny","kate","meg","rosa","lena","nina","gina","deb",
]);

function isFemale(name: string): boolean {
  return FEMALE_NAMES.has(name.trim().split(/\s+/)[0].toLowerCase());
}

// --- Sprite trait system: derive visual appearance from system prompt + job title ---
interface SpriteTraits {
  hairColor: string;
  hairStyle: "short" | "long" | "bun" | "mohawk" | "bald" | "curly" | "ponytail" | "spiky";
  skinTone: string;
  shirtColor: string;
  pantsColor: string;
  shoeColor: string;
  accessory: "none" | "glasses" | "sunglasses" | "headphones" | "hat" | "hardhat" | "crown" | "bowtie" | "stethoscope";
  extra: "none" | "beard" | "mustache";
}

function parseTraits(prompt: string, jobTitle: string, name: string, fallbackColor: string): SpriteTraits {
  const text = `${prompt} ${jobTitle} ${name}`.toLowerCase();

  // Hair color
  let hairColor = "#3b2f1e";
  if (/\b(blonde|blond)\b/.test(text)) hairColor = "#d4a843";
  else if (/\b(red hair|redhead|ginger)\b/.test(text)) hairColor = "#b5451b";
  else if (/\b(white hair|silver hair|gray hair|grey hair|elderly|old)\b/.test(text)) hairColor = "#c0c0c0";
  else if (/\b(black hair)\b/.test(text)) hairColor = "#1a1a1a";
  else if (/\b(blue hair)\b/.test(text)) hairColor = "#4466cc";
  else if (/\b(pink hair)\b/.test(text)) hairColor = "#e87baa";
  else if (/\b(purple hair)\b/.test(text)) hairColor = "#8855cc";
  else if (/\b(green hair)\b/.test(text)) hairColor = "#44aa66";
  else if (isFemale(name)) hairColor = "#6b3a2a";

  // Hair style
  let hairStyle: SpriteTraits["hairStyle"] = isFemale(name) ? "long" : "short";
  if (/\b(bald|shaved head)\b/.test(text)) hairStyle = "bald";
  else if (/\b(mohawk|punk)\b/.test(text)) hairStyle = "mohawk";
  else if (/\b(bun|top.?knot)\b/.test(text)) hairStyle = "bun";
  else if (/\b(curly|afro)\b/.test(text)) hairStyle = "curly";
  else if (/\b(ponytail)\b/.test(text)) hairStyle = "ponytail";
  else if (/\b(spiky|spiked)\b/.test(text)) hairStyle = "spiky";
  else if (/\b(long hair)\b/.test(text)) hairStyle = "long";
  else if (/\b(short hair)\b/.test(text)) hairStyle = "short";

  // Skin tone
  let skinTone = "#f5c6a0";
  if (/\b(dark skin|african|black person)\b/.test(text)) skinTone = "#8d5524";
  else if (/\b(brown skin|indian|latino|latina|hispanic|south asian)\b/.test(text)) skinTone = "#c68642";
  else if (/\b(olive skin|mediterranean|middle eastern)\b/.test(text)) skinTone = "#d4a574";
  else if (/\b(east asian|asian|japanese|chinese|korean)\b/.test(text)) skinTone = "#f1d0a4";
  else if (/\b(pale|fair skin)\b/.test(text)) skinTone = "#fce4d6";

  // Shirt color from job/persona
  let shirtColor = fallbackColor;
  if (/\b(doctor|nurse|medical|hospital|lab)\b/.test(text)) shirtColor = "#e8e8e8";
  else if (/\b(military|army|soldier|camo)\b/.test(text)) shirtColor = "#5a6b3c";
  else if (/\b(chef|cook|baker|kitchen)\b/.test(text)) shirtColor = "#f0f0f0";
  else if (/\b(fireman|firefighter|fire)\b/.test(text)) shirtColor = "#cc3333";
  else if (/\b(police|cop|officer|law enforcement)\b/.test(text)) shirtColor = "#2a3a6a";
  else if (/\b(goth|dark|metal|emo)\b/.test(text)) shirtColor = "#222222";
  else if (/\b(business|executive|ceo|formal|suit|corporate|lawyer|attorney)\b/.test(text)) shirtColor = "#2d3748";
  else if (/\b(artist|creative|painter|designer)\b/.test(text)) shirtColor = "#8b5cf6";
  else if (/\b(punk|rock|rebel)\b/.test(text)) shirtColor = "#111111";
  else if (/\b(hippie|bohemian|free.?spirit)\b/.test(text)) shirtColor = "#e8944a";
  else if (/\b(tech|engineer|developer|programmer|coder|hacker)\b/.test(text)) shirtColor = "#334155";
  else if (/\b(sports|athlete|coach|fitness|trainer)\b/.test(text)) shirtColor = "#dc2626";

  // Pants color
  let pantsColor = "#2d4a7a";
  if (/\b(khaki|casual)\b/.test(text)) pantsColor = "#a08060";
  else if (/\b(suit|formal|business|corporate|lawyer|attorney)\b/.test(text)) pantsColor = "#1e293b";
  else if (/\b(military|army|camo)\b/.test(text)) pantsColor = "#4a5a2c";
  else if (/\b(goth|punk|dark|metal)\b/.test(text)) pantsColor = "#111111";
  else if (/\b(scrubs|doctor|nurse|medical)\b/.test(text)) pantsColor = "#5b9bd5";
  else if (/\b(chef|cook)\b/.test(text)) pantsColor = "#1a1a1a";
  else if (/\b(sports|athlete|fitness)\b/.test(text)) pantsColor = "#1e293b";

  // Shoe color
  let shoeColor = "#333";
  if (/\b(sports|athlete|fitness|runner)\b/.test(text)) shoeColor = "#e8e8e8";
  else if (/\b(cowboy|western|country)\b/.test(text)) shoeColor = "#8b4513";
  else if (/\b(formal|suit|business)\b/.test(text)) shoeColor = "#1a1a1a";

  // Accessory
  let accessory: SpriteTraits["accessory"] = "none";
  if (/\b(glasses|spectacles|nerdy|nerd|professor|academic|librarian)\b/.test(text)) accessory = "glasses";
  else if (/\b(sunglasses|cool|shades|secret agent|spy)\b/.test(text)) accessory = "sunglasses";
  else if (/\b(headphones|music|dj|audio|podcast)\b/.test(text)) accessory = "headphones";
  else if (/\b(hard.?hat|construction|builder|safety)\b/.test(text)) accessory = "hardhat";
  else if (/\b(hat|cowboy|cap|beanie)\b/.test(text)) accessory = "hat";
  else if (/\b(crown|king|queen|royal|princess|prince)\b/.test(text)) accessory = "crown";
  else if (/\b(bow.?tie|fancy|butler|waiter|classy)\b/.test(text)) accessory = "bowtie";
  else if (/\b(doctor|physician|medical|stethoscope)\b/.test(text)) accessory = "stethoscope";

  // Extra facial
  let extra: SpriteTraits["extra"] = "none";
  if (/\b(beard|bearded|lumberjack)\b/.test(text)) extra = "beard";
  else if (/\b(mustache|moustache)\b/.test(text)) extra = "mustache";

  return { hairColor, hairStyle, skinTone, shirtColor, pantsColor, shoeColor, accessory, extra };
}

function CharacterSprite({ traits, frame, facing }: { traits: SpriteTraits; frame: number; facing: string }) {
  const flip = facing === "left";
  const f = frame % 2;
  const { hairColor, hairStyle, skinTone, shirtColor, pantsColor, shoeColor, accessory, extra } = traits;

  return (
    <svg viewBox="0 0 16 22" className="w-8 h-11" style={{ imageRendering: "pixelated", transform: flip ? "scaleX(-1)" : "" }}>
      {/* Hair back layer for long styles */}
      {(hairStyle === "long" || hairStyle === "ponytail") && (
        <>
          <rect x="3" y="3" width="2" height="5" fill={hairColor} />
          <rect x="11" y="3" width="2" height="5" fill={hairColor} />
        </>
      )}

      {/* Hair top */}
      {hairStyle === "bald" ? null :
       hairStyle === "mohawk" ? (
        <>
          <rect x="6" y="-2" width="4" height="4" fill={hairColor} />
          <rect x="7" y="-3" width="2" height="1" fill={hairColor} />
        </>
       ) : hairStyle === "curly" ? (
        <>
          <rect x="4" y="-1" width="8" height="3" fill={hairColor} />
          <rect x="3" y="0" width="10" height="3" fill={hairColor} />
          <rect x="3" y="2" width="2" height="2" fill={hairColor} />
          <rect x="11" y="2" width="2" height="2" fill={hairColor} />
        </>
       ) : hairStyle === "spiky" ? (
        <>
          <rect x="4" y="0" width="8" height="2" fill={hairColor} />
          <rect x="5" y="-1" width="2" height="1" fill={hairColor} />
          <rect x="8" y="-2" width="2" height="2" fill={hairColor} />
          <rect x="11" y="-1" width="1" height="1" fill={hairColor} />
        </>
       ) : hairStyle === "bun" ? (
        <>
          <rect x="5" y="0" width="6" height="2" fill={hairColor} />
          <rect x="4" y="1" width="8" height="1" fill={hairColor} />
          <circle cx="8" cy="-1" r="2" fill={hairColor} />
        </>
       ) : hairStyle === "ponytail" ? (
        <>
          <rect x="5" y="0" width="6" height="2" fill={hairColor} />
          <rect x="4" y="1" width="8" height="1" fill={hairColor} />
          <rect x="11" y="2" width="2" height="6" fill={hairColor} />
          <rect x="12" y="5" width="2" height="3" fill={hairColor} />
        </>
       ) : hairStyle === "long" ? (
        <>
          <rect x="4" y="0" width="8" height="2" fill={hairColor} />
          <rect x="3" y="1" width="10" height="2" fill={hairColor} />
        </>
       ) : ( // short
        <>
          <rect x="5" y="0" width="6" height="2" fill={hairColor} />
          <rect x="4" y="1" width="8" height="1" fill={hairColor} />
        </>
       )
      }

      {/* Head */}
      <rect x="5" y="2" width="6" height="5" fill={skinTone} />

      {/* Eyes */}
      <rect x="6" y="4" width="1" height="1" fill="#222" />
      <rect x="9" y="4" width="1" height="1" fill="#222" />

      {/* Accessory: glasses */}
      {accessory === "glasses" && (
        <>
          <rect x="5" y="3.5" width="3" height="2" rx="0.5" fill="none" stroke="#555" strokeWidth="0.5" />
          <rect x="8.5" y="3.5" width="3" height="2" rx="0.5" fill="none" stroke="#555" strokeWidth="0.5" />
          <line x1="8" y1="4.2" x2="8.5" y2="4.2" stroke="#555" strokeWidth="0.4" />
        </>
      )}
      {accessory === "sunglasses" && (
        <>
          <rect x="5" y="3.5" width="3" height="2" rx="0.5" fill="#111" />
          <rect x="8.5" y="3.5" width="3" height="2" rx="0.5" fill="#111" />
          <line x1="8" y1="4.2" x2="8.5" y2="4.2" stroke="#333" strokeWidth="0.5" />
        </>
      )}

      {/* Facial extras */}
      {extra === "beard" && (
        <rect x="5.5" y="6" width="5" height="2" rx="1" fill={hairColor} opacity="0.8" />
      )}
      {extra === "mustache" && (
        <rect x="6" y="5.5" width="4" height="1" rx="0.5" fill={hairColor} opacity="0.8" />
      )}

      {/* Accessory: headphones */}
      {accessory === "headphones" && (
        <>
          <rect x="3" y="2" width="2" height="3" rx="1" fill="#444" />
          <rect x="11" y="2" width="2" height="3" rx="1" fill="#444" />
          <rect x="4" y="0" width="8" height="1" rx="0.5" fill="#555" />
        </>
      )}

      {/* Accessory: hardhat */}
      {accessory === "hardhat" && (
        <>
          <rect x="3" y="-1" width="10" height="3" rx="1" fill="#f5c542" />
          <rect x="2" y="1" width="12" height="1" fill="#daa520" />
        </>
      )}

      {/* Accessory: hat */}
      {accessory === "hat" && (
        <>
          <rect x="4" y="-1" width="8" height="3" rx="1" fill="#5a4030" />
          <rect x="2" y="1" width="12" height="1" fill="#4a3020" />
        </>
      )}

      {/* Accessory: crown */}
      {accessory === "crown" && (
        <>
          <rect x="4" y="-1" width="8" height="2" fill="#ffd700" />
          <rect x="5" y="-3" width="1" height="2" fill="#ffd700" />
          <rect x="7.5" y="-3" width="1" height="2" fill="#ffd700" />
          <rect x="10" y="-3" width="1" height="2" fill="#ffd700" />
          <circle cx="5.5" cy="-3" r="0.6" fill="#e44" />
          <circle cx="8" cy="-3" r="0.6" fill="#4ae" />
          <circle cx="10.5" cy="-3" r="0.6" fill="#4e4" />
        </>
      )}

      {/* Shirt */}
      <rect x="4" y="7" width="8" height="5" fill={shirtColor} />

      {/* Accessory: bowtie */}
      {accessory === "bowtie" && (
        <>
          <rect x="6" y="7" width="4" height="1.5" fill="#cc2233" />
          <rect x="7.5" y="7.2" width="1" height="1" fill="#881122" />
        </>
      )}

      {/* Accessory: stethoscope */}
      {accessory === "stethoscope" && (
        <>
          <line x1="7" y1="7" x2="6" y2="10" stroke="#4488aa" strokeWidth="0.6" />
          <line x1="9" y1="7" x2="10" y2="10" stroke="#4488aa" strokeWidth="0.6" />
          <circle cx="8" cy="11" r="1" fill="#5599bb" />
        </>
      )}

      {/* Collar/tie for suits */}
      {/suit|formal|business|corporate|lawyer|executive/.test(shirtColor === "#2d3748" ? "suit" : "") && (
        <rect x="7" y="7" width="2" height="4" fill="#888" opacity="0.5" />
      )}

      {/* Arms */}
      <rect x="2" y={f === 0 ? "8" : "9"} width="2" height="4" fill={shirtColor} />
      <rect x="12" y={f === 0 ? "9" : "8"} width="2" height="4" fill={shirtColor} />
      <rect x="2" y={f === 0 ? "12" : "13"} width="2" height="1" fill={skinTone} />
      <rect x="12" y={f === 0 ? "13" : "12"} width="2" height="1" fill={skinTone} />

      {/* Pants */}
      <rect x="5" y="12" width="6" height="4" fill={pantsColor} />
      <rect x="5" y="16" width="2" height={f === 0 ? "3" : "2"} fill={pantsColor} />
      <rect x="9" y="16" width="2" height={f === 0 ? "2" : "3"} fill={pantsColor} />

      {/* Shoes */}
      <rect x="4" y={f === 0 ? "19" : "18"} width="3" height="2" fill={shoeColor} />
      <rect x="9" y={f === 0 ? "18" : "19"} width="3" height="2" fill={shoeColor} />
    </svg>
  );
}

function getModelDomain(model: string): { domain: string; name: string } {
  const m = model.toLowerCase();
  if (m.includes("claude") || m.includes("anthropic")) return { domain: "anthropic.com", name: "Anthropic" };
  if (m.includes("gpt") || m.includes("o1") || m.includes("o3") || m.includes("openai")) return { domain: "openai.com", name: "OpenAI" };
  if (m.includes("gemini") || m.includes("google")) return { domain: "google.com", name: "Google" };
  if (m.includes("llama") || m.includes("meta")) return { domain: "meta.com", name: "Meta" };
  if (m.includes("grok") || m.includes("xai")) return { domain: "x.ai", name: "xAI" };
  if (m.includes("mistral")) return { domain: "mistral.ai", name: "Mistral" };
  if (m.includes("deepseek")) return { domain: "deepseek.com", name: "DeepSeek" };
  return { domain: "", name: "AI" };
}

function ModelBadge({ model }: { model: string }) {
  const { domain, name } = getModelDomain(model);
  if (!domain) return null;
  return (
    <img
      src={`https://cdn.brandfetch.io/domain/${domain}?c=1id3n10pdBTarCHI0db`}
      alt={name}
      title={name}
      className="w-3.5 h-3.5 rounded-full object-contain"
      style={{ background: "rgba(0,0,0,0.4)" }}
    />
  );
}

function MaleSprite({ color, frame, facing }: { color: string; frame: number; facing: string }) {
  const flip = facing === "left";
  return (
    <svg viewBox="0 0 16 22" className="w-8 h-11" style={{ imageRendering: "pixelated", transform: flip ? "scaleX(-1)" : "" }}>
      <rect x="5" y="0" width="6" height="2" fill="#3b2f1e" />
      <rect x="4" y="1" width="8" height="1" fill="#3b2f1e" />
      <rect x="5" y="2" width="6" height="5" fill="#f5c6a0" />
      <rect x="6" y="4" width="1" height="1" fill="#222" />
      <rect x="9" y="4" width="1" height="1" fill="#222" />
      <rect x="4" y="7" width="8" height="5" fill={color} />
      <rect x="7" y="7" width="2" height="1" fill="#fff" opacity="0.4" />
      <rect x="2" y={frame % 2 === 0 ? "8" : "9"} width="2" height="4" fill={color} />
      <rect x="12" y={frame % 2 === 0 ? "9" : "8"} width="2" height="4" fill={color} />
      <rect x="2" y={frame % 2 === 0 ? "12" : "13"} width="2" height="1" fill="#f5c6a0" />
      <rect x="12" y={frame % 2 === 0 ? "13" : "12"} width="2" height="1" fill="#f5c6a0" />
      <rect x="5" y="12" width="6" height="4" fill="#2d4a7a" />
      <rect x="5" y="16" width="2" height={frame % 2 === 0 ? "3" : "2"} fill="#2d4a7a" />
      <rect x="9" y="16" width="2" height={frame % 2 === 0 ? "2" : "3"} fill="#2d4a7a" />
      <rect x="4" y={frame % 2 === 0 ? "19" : "18"} width="3" height="2" fill="#333" />
      <rect x="9" y={frame % 2 === 0 ? "18" : "19"} width="3" height="2" fill="#333" />
    </svg>
  );
}

function FemaleSprite({ color, frame, facing }: { color: string; frame: number; facing: string }) {
  const flip = facing === "left";
  return (
    <svg viewBox="0 0 16 22" className="w-8 h-11" style={{ imageRendering: "pixelated", transform: flip ? "scaleX(-1)" : "" }}>
      <rect x="4" y="0" width="8" height="2" fill="#6b3a2a" />
      <rect x="3" y="1" width="10" height="2" fill="#6b3a2a" />
      <rect x="3" y="3" width="2" height="4" fill="#6b3a2a" />
      <rect x="11" y="3" width="2" height="4" fill="#6b3a2a" />
      <rect x="5" y="2" width="6" height="5" fill="#f5c6a0" />
      <rect x="6" y="4" width="1" height="1" fill="#222" />
      <rect x="9" y="4" width="1" height="1" fill="#222" />
      <rect x="7" y="6" width="2" height="1" fill="#d4758a" />
      <rect x="4" y="7" width="8" height="4" fill={color} />
      <rect x="7" y="7" width="2" height="1" fill="#f5c6a0" />
      <rect x="2" y={frame % 2 === 0 ? "8" : "9"} width="2" height="3" fill={color} />
      <rect x="12" y={frame % 2 === 0 ? "9" : "8"} width="2" height="3" fill={color} />
      <rect x="2" y={frame % 2 === 0 ? "11" : "12"} width="2" height="1" fill="#f5c6a0" />
      <rect x="12" y={frame % 2 === 0 ? "12" : "11"} width="2" height="1" fill="#f5c6a0" />
      <rect x="3" y="11" width="10" height="3" fill={color} />
      <rect x="4" y="14" width="8" height="1" fill={color} />
      <rect x="5" y="15" width="2" height={frame % 2 === 0 ? "3" : "2"} fill="#f5c6a0" />
      <rect x="9" y="15" width="2" height={frame % 2 === 0 ? "2" : "3"} fill="#f5c6a0" />
      <rect x="4" y={frame % 2 === 0 ? "18" : "17"} width="3" height="1" fill="#c44" />
      <rect x="9" y={frame % 2 === 0 ? "17" : "18"} width="3" height="1" fill="#c44" />
    </svg>
  );
}

const COLORS = ["#6366f1", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6", "#f97316"];
const WATER_COOLER = { x: 7, y: 50 };

function isDog(agent: { jobTitle: string }): boolean {
  return agent.jobTitle.toLowerCase().includes("office dog");
}

function DogSprite({ color, frame, facing }: { color: string; frame: number; facing: string }) {
  const flip = facing === "left";
  const bobY = frame % 2 === 0 ? 0 : -0.5;
  const tailWag = frame % 2 === 0 ? 12 : -8;
  return (
    <svg viewBox="0 0 20 20" width="28" height="28" style={{ transform: `scaleX(${flip ? -1 : 1})`, imageRendering: "pixelated" }}>
      {/* Body */}
      <ellipse cx="10" cy={12 + bobY} rx="5" ry="3" fill={color} />
      {/* Head */}
      <circle cx="15" cy={9 + bobY} r="3" fill={color} />
      {/* Ear */}
      <ellipse cx="16.5" cy={7 + bobY} rx="1.5" ry="2" fill={color} opacity="0.7" />
      {/* Eye */}
      <circle cx="16" cy={8.5 + bobY} r="0.8" fill="#111" />
      <circle cx="16.3" cy={8.2 + bobY} r="0.3" fill="white" />
      {/* Nose */}
      <circle cx="17.5" cy={9.5 + bobY} r="0.6" fill="#333" />
      {/* Tongue (panting) */}
      {frame % 3 === 0 && <ellipse cx="17" cy={11 + bobY} rx="0.6" ry="1" fill="#ff7b9c" />}
      {/* Tail */}
      <line x1="5" y1={11 + bobY} x2="3" y2={8 + bobY + tailWag * 0.05} stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      {/* Legs */}
      <line x1="8" y1={14 + bobY} x2="8" y2="17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
      <line x1="12" y1={14 + bobY} x2="12" y2="17" stroke={color} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function getTodayKey() {
  return new Date().toISOString().slice(0, 10);
}

function loadConversation(agentId: string): Message[] {
  const key = `bfo-chat-${agentId}-${getTodayKey()}`;
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveConversation(agentId: string, messages: Message[]) {
  const key = `bfo-chat-${agentId}-${getTodayKey()}`;
  localStorage.setItem(key, JSON.stringify(messages));
}

export default function Office() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [chatAgent, setChatAgent] = useState<Agent | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [positions, setPositions] = useState<Record<string, AgentPos>>({});
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [pendingFile, setPendingFile] = useState<FileAttachment | null>(null);
  const ACCEPTED_TYPES = ["application/pdf", "image/png", "image/jpeg", "image/gif", "image/webp"];
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [inMeeting, setInMeeting] = useState(false);
  const [meetingTopic, setMeetingTopic] = useState("");
  const [meetingLog, setMeetingLog] = useState<{ agent: string; color: string; text: string }[]>([]);
  const [meetingRunning, setMeetingRunning] = useState(false);
  const [meetingInput, setMeetingInput] = useState("");
  const meetingAbortRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const meetingEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const meetingInputRef = useRef<HTMLInputElement>(null);
  const animRef = useRef<number>(0);
  const posRef = useRef<Record<string, AgentPos>>({});
  const toastIdRef = useRef(0);

  useEffect(() => {
    let unsubscribe: (() => void) | undefined;
    async function setup() {
      const { db, authReady } = await import("../firebase");
      await authReady;
      const { ref, onValue } = await import("firebase/database");
      unsubscribe = onValue(ref(db, "agents"), (snapshot) => {
        const data = snapshot.val();
        if (data) {
          const arr = Object.entries(data).map(([id, value]) => {
            const v = value as Record<string, unknown>;
            return {
              id,
              name: (v.name as string) || "",
              jobTitle: (v.jobTitle as string) || "",
              model: (v.model as string) || "",
              systemPrompt: (v.systemPrompt as string) || "",
              apiKey: (v.apiKey as string) || "",
            };
          });
          setAgents(arr);
        } else { setAgents([]); }
        setLoading(false);
      });
    }
    setup();
    return () => unsubscribe?.();
  }, []);

  // Initialize positions
  useEffect(() => {
    if (agents.length === 0) return;
    const newPos: Record<string, AgentPos> = {};
    const maxPerRow = Math.ceil(agents.length / 2);
    agents.forEach((agent, i) => {
      const row = i < maxPerRow ? 0 : 1;
      const col = row === 0 ? i : i - maxPerRow;
      const rowCount = row === 0 ? maxPerRow : agents.length - maxPerRow;
      const xStep = 70 / (rowCount + 1);
      const deskX = 15 + xStep * (col + 1);
      const deskY = row === 0 ? 38 : 68;
      if (posRef.current[agent.id]) {
        newPos[agent.id] = { ...posRef.current[agent.id], deskX, deskY };
      } else {
        newPos[agent.id] = {
          x: deskX, y: deskY, targetX: deskX, targetY: deskY,
          deskX, deskY, state: "working",
          stateTimer: 200 + Math.random() * 300,
          facing: "right", walkFrame: 0,
        };
      }
    });
    posRef.current = newPos;
    setPositions({ ...newPos });
  }, [agents]);

  // Animation loop
  useEffect(() => {
    let lastTime = performance.now();
    let frameCount = 0;
    function tick() {
      const now = performance.now();
      const dt = (now - lastTime) / 16.67;
      lastTime = now;
      frameCount++;
      const pos = posRef.current;
      let changed = false;
      for (const id of Object.keys(pos)) {
        const p = pos[id];
        p.stateTimer -= dt;
        if (p.state === "working" && p.stateTimer <= 0) {
          const roll = Math.random();
          if (roll < 0.25) {
            p.state = "walking";
            p.targetX = WATER_COOLER.x + Math.random() * 6;
            p.targetY = WATER_COOLER.y + Math.random() * 6 - 3;
          } else if (roll < 0.45) {
            p.state = "walking";
            p.targetX = Math.max(5, Math.min(85, p.deskX + (Math.random() - 0.5) * 20));
            p.targetY = Math.max(25, Math.min(90, p.deskY + (Math.random() - 0.5) * 15));
          } else {
            p.stateTimer = 150 + Math.random() * 250;
          }
          changed = true;
        }
        if (p.state === "walking") {
          const dx = p.targetX - p.x;
          const dy = p.targetY - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 1) {
            p.x = p.targetX; p.y = p.targetY;
            const atWater = Math.abs(p.x - WATER_COOLER.x) < 10 && Math.abs(p.y - WATER_COOLER.y) < 10;
            p.state = atWater ? "water" : "idle";
            p.stateTimer = (atWater ? 80 : 40) + Math.random() * 60;
          } else {
            const speed = 0.25 * dt;
            p.x += (dx / dist) * speed;
            p.y += (dy / dist) * speed;
            p.facing = dx > 0 ? "right" : "left";
            if (frameCount % 8 === 0) p.walkFrame++;
          }
          changed = true;
        }
        if ((p.state === "water" || p.state === "idle") && p.stateTimer <= 0) {
          p.state = "walking";
          p.targetX = p.deskX;
          p.targetY = p.deskY;
          changed = true;
        }
      }
      if (changed || frameCount % 4 === 0) setPositions({ ...pos });
      animRef.current = requestAnimationFrame(tick);
    }
    animRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animRef.current);
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function addToast(text: string, agentName: string) {
    const id = ++toastIdRef.current;
    setToasts((t) => [...t, { id, text, agent: agentName }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }

  function openChat(agent: Agent) {
    setChatAgent(agent);
    const saved = loadConversation(agent.id);
    setMessages(saved);
    setInput("");
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  function closeChat() {
    setChatAgent(null);
    setMessages([]);
    setInput("");
    setStreaming(false);
  }

  function handleAttachFile(file: File) {
    if (!ACCEPTED_TYPES.includes(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const base64 = (reader.result as string).split(",")[1];
      setPendingFile({ name: file.name, base64, mediaType: file.type });
    };
    reader.readAsDataURL(file);
  }

  function handleFileDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files[0];
    if (file) handleAttachFile(file);
  }

  function handleFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleAttachFile(file);
    e.target.value = "";
  }

  function buildApiMessages(msgs: Message[]) {
    return msgs.map((m) => {
      if (m.file) {
        const isImage = m.file.mediaType.startsWith("image/");
        const content: unknown[] = isImage
          ? [{ type: "image", source: { type: "base64", media_type: m.file.mediaType, data: m.file.base64 } }]
          : [{ type: "document", source: { type: "base64", media_type: m.file.mediaType, data: m.file.base64 } }];
        if (m.content && m.content !== `[Attached: ${m.file.name}]`) {
          content.push({ type: "text", text: m.content });
        }
        return { role: m.role, content };
      }
      return { role: m.role, content: m.content };
    });
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if ((!input.trim() && !pendingFile) || !chatAgent || streaming) return;

    const userMessage: Message = { role: "user", content: input.trim() || (pendingFile ? `[Attached: ${pendingFile.name}]` : ""), file: pendingFile || undefined };
    const newMessages = [...messages, userMessage];
    setMessages(newMessages);
    saveConversation(chatAgent.id, newMessages);
    setInput("");
    setPendingFile(null);
    setStreaming(true);
    addToast(`You: ${userMessage.content.slice(0, 60)}${userMessage.content.length > 60 ? "..." : ""}`, chatAgent.name);

    let content = "";
    setMessages([...newMessages, { role: "assistant", content: "" }]);

    try {
      await streamChat(
        chatAgent.model,
        chatAgent.apiKey,
        buildApiMessages(newMessages),
        chatAgent.systemPrompt || undefined,
        {
          onToken: (text) => {
            content += text;
            setMessages([...newMessages, { role: "assistant" as const, content }]);
          },
          onDone: () => {},
          onError: (err) => {
            const withErr = [...newMessages, { role: "assistant" as const, content: `Error: ${err}` }];
            setMessages(withErr);
            saveConversation(chatAgent.id, withErr);
          },
        },
      );

      const final = [...newMessages, { role: "assistant" as const, content }];
      setMessages(final);
      saveConversation(chatAgent.id, final);
      addToast(`${chatAgent.name}: ${content.slice(0, 60)}${content.length > 60 ? "..." : ""}`, chatAgent.name);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Unknown error";
      const withErr = [...newMessages, { role: "assistant" as const, content: `Error: ${errMsg}` }];
      setMessages(withErr);
      saveConversation(chatAgent.id, withErr);
    }
    setStreaming(false);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(e); }
    if (e.key === "Escape") closeChat();
  }

  function callMeeting() {
    closeChat();
    setInMeeting(true);
    setMeetingLog([]);
    setMeetingTopic("");
    setMeetingRunning(false);
    meetingAbortRef.current = false;
    setTimeout(() => meetingInputRef.current?.focus(), 200);
  }

  function leaveMeeting() {
    meetingAbortRef.current = true;
    setInMeeting(false);
    setMeetingRunning(false);
    setMeetingLog([]);
  }

  async function callAgent(agent: Agent, history: { role: string; content: string }[]): Promise<string> {
    const sysPrompt = `${agent.systemPrompt ? agent.systemPrompt + "\n\n" : ""}You are ${agent.name}${agent.jobTitle ? `, ${agent.jobTitle}` : ""}. You are in a meeting with colleagues. Keep your responses concise (2-4 sentences). Be conversational and direct.`;
    return callLLM(agent.model, agent.apiKey, history, sysPrompt);
  }

  async function startMeeting(e: React.FormEvent) {
    e.preventDefault();
    if (!meetingInput.trim() || agents.length < 2 || meetingRunning) return;

    const topic = meetingInput.trim();
    setMeetingInput("");
    setMeetingTopic(topic);
    setMeetingRunning(true);
    meetingAbortRef.current = false;

    const log: { agent: string; color: string; text: string }[] = [];
    const conversationHistory: { role: string; content: string }[] = [
      { role: "user", content: `Meeting topic: ${topic}\n\nPlease share your thoughts on this topic.` },
    ];

    // 2 rounds of discussion (each agent speaks once per round)
    for (let round = 0; round < 2; round++) {
      for (let i = 0; i < agents.length; i++) {
        if (meetingAbortRef.current) return;

        const agent = agents[i];
        const color = COLORS[i % COLORS.length];

        // Add thinking indicator
        const thinkingEntry = { agent: agent.name, color, text: "..." };
        setMeetingLog([...log, thinkingEntry]);

        const response = await callAgent(agent, conversationHistory);
        if (meetingAbortRef.current) return;

        const entry = { agent: agent.name, color, text: response };
        log.push(entry);
        setMeetingLog([...log]);

        // Add this agent's response to history so next agent sees it
        conversationHistory.push({ role: "assistant", content: `${agent.name}: ${response}` });
        if (i < agents.length - 1 || round < 1) {
          conversationHistory.push({ role: "user", content: "Please respond to what was just said and add your perspective." });
        }
      }
    }

    setMeetingRunning(false);
  }

  useEffect(() => {
    meetingEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [meetingLog]);

  function handleMeetingKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); startMeeting(e); }
    if (e.key === "Escape") leaveMeeting();
  }

  // Get seat positions around a conference table
  function getSeatPosition(index: number, total: number) {
    // Distribute agents around an oval conference table
    const angle = (index / total) * Math.PI * 2 - Math.PI / 2;
    const rx = 30; // x radius
    const ry = 18; // y radius
    return {
      x: 50 + rx * Math.cos(angle),
      y: 52 + ry * Math.sin(angle),
    };
  }

  if (loading) return <p className="text-gray-500">Loading...</p>;

  return (
    <div className="flex gap-4 h-[calc(100vh-4rem)]">
      {/* Left: Room */}
      <div className="flex-1 flex flex-col min-w-0">
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h1 className="text-2xl font-bold">{inMeeting ? "Meeting Room" : "Office"}</h1>
          {agents.length >= 2 && (
            <button
              onClick={inMeeting ? leaveMeeting : callMeeting}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg cursor-pointer transition-colors ${
                inMeeting
                  ? "bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30"
                  : "bg-white/10 text-white hover:bg-white/15 border border-white/10"
              }`}
            >
              {inMeeting ? "Leave Meeting" : "Call Meeting"}
            </button>
          )}
        </div>

        <div className="relative flex-1 max-h-[400px] rounded-lg overflow-visible" style={{
          aspectRatio: "4/3",
          background: "#e8dcc8",
          boxShadow: "inset 0 0 0 4px #6b7b8d, inset 0 0 0 6px #4a5568",
        }}>
          {/* Floor tile pattern */}
          <div className="absolute inset-0 rounded-lg" style={{
            background: "repeating-conic-gradient(#e2d4be 0% 25%, #e8dcc8 0% 50%) 0 0 / 40px 40px",
          }} />
          {/* Floor light cast from windows */}
          <div className="absolute top-[18%] left-[15%] w-[30%] h-[35%] rounded-sm" style={{
            background: "linear-gradient(180deg, rgba(255,255,230,0.15) 0%, transparent 100%)",
          }} />
          <div className="absolute top-[18%] right-[15%] w-[30%] h-[35%] rounded-sm" style={{
            background: "linear-gradient(180deg, rgba(255,255,230,0.15) 0%, transparent 100%)",
          }} />

          {/* Wall */}
          <div className="absolute top-0 left-0 right-0 h-[18%] rounded-t-lg" style={{
            background: "linear-gradient(180deg, #6b7b8d 0%, #7a8a9c 100%)",
          }}>
            {/* Baseboard */}
            <div className="absolute bottom-0 left-0 right-0 h-[4px] bg-[#4a5060]" />
            {/* Window left */}
            <div className="absolute top-[15%] left-[6%] w-[22%] h-[60%] rounded-sm overflow-hidden" style={{
              background: "linear-gradient(180deg, #87ceeb 0%, #aadcf0 100%)",
              border: "3px solid #5a6a7a",
              boxShadow: "inset 0 0 0 1px #9ab",
            }}>
              <div className="absolute inset-0 border-r-2 border-[#5a6a7a] w-1/2" />
            </div>
            {/* Window right */}
            <div className="absolute top-[15%] right-[6%] w-[22%] h-[60%] rounded-sm overflow-hidden" style={{
              background: "linear-gradient(180deg, #87ceeb 0%, #aadcf0 100%)",
              border: "3px solid #5a6a7a",
              boxShadow: "inset 0 0 0 1px #9ab",
            }}>
              <div className="absolute inset-0 border-r-2 border-[#5a6a7a] w-1/2" />
            </div>
            {/* Center window — rainy scene with two children holding umbrellas */}
            <div className="absolute top-[8%] left-[32%] w-[36%] h-[75%] rounded-sm overflow-hidden" style={{
              border: "3px solid #5a6a7a",
              boxShadow: "inset 0 0 0 1px #9ab",
            }}>
              {/* Sky — overcast */}
              <div className="absolute inset-0" style={{
                background: "linear-gradient(180deg, #8899aa 0%, #a0b0c0 40%, #b0bfcc 70%, #7a9a6a 85%, #6a8a5a 100%)",
              }} />
              {/* Rain streaks */}
              <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.3 }}>
                <line x1="15%" y1="0" x2="12%" y2="30%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="30%" y1="5%" x2="27%" y2="35%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="50%" y1="0" x2="47%" y2="28%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="70%" y1="8%" x2="67%" y2="38%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="85%" y1="2%" x2="82%" y2="32%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="22%" y1="15%" x2="19%" y2="45%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="42%" y1="10%" x2="39%" y2="40%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="62%" y1="3%" x2="59%" y2="33%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="78%" y1="12%" x2="75%" y2="42%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="10%" y1="20%" x2="7%" y2="50%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="55%" y1="18%" x2="52%" y2="48%" stroke="#6688aa" strokeWidth="0.5" />
                <line x1="90%" y1="15%" x2="87%" y2="45%" stroke="#6688aa" strokeWidth="0.5" />
              </svg>
              {/* Puddles on ground */}
              <div className="absolute bottom-[12%] left-[10%] w-[25%] h-[4%] rounded-full bg-[#7a9a9a] opacity-30" />
              <div className="absolute bottom-[10%] right-[15%] w-[20%] h-[3%] rounded-full bg-[#7a9a9a] opacity-25" />
              {/* Child 1 — left, with red umbrella, looking right (toward window) */}
              <svg className="absolute bottom-[14%] left-[18%]" width="24" height="30" viewBox="0 0 24 30" style={{ imageRendering: "pixelated" }}>
                {/* Umbrella */}
                <ellipse cx="12" cy="5" rx="10" ry="5" fill="#cc3333" />
                <ellipse cx="12" cy="5" rx="10" ry="5" fill="url(#umbrellaShine1)" />
                <line x1="12" y1="5" x2="12" y2="22" stroke="#6b4226" strokeWidth="1" />
                <path d="M12 22 Q14 24 12 25" fill="none" stroke="#6b4226" strokeWidth="0.8" />
                {/* Head */}
                <circle cx="12" cy="14" r="3" fill="#f5c6a0" />
                {/* Hair */}
                <rect x="9" y="11" width="6" height="2" rx="1" fill="#5a3a1a" />
                {/* Eyes looking at window */}
                <rect x="13" y="13.5" width="1" height="1" fill="#222" />
                {/* Body — raincoat */}
                <rect x="9" y="17" width="6" height="6" rx="1" fill="#e8c840" />
                {/* Legs + boots */}
                <rect x="10" y="23" width="2" height="3" fill="#e8c840" />
                <rect x="13" y="23" width="2" height="3" fill="#e8c840" />
                <rect x="9.5" y="26" width="3" height="2" rx="0.5" fill="#cc3333" />
                <rect x="12.5" y="26" width="3" height="2" rx="0.5" fill="#cc3333" />
                <defs>
                  <radialGradient id="umbrellaShine1" cx="40%" cy="30%">
                    <stop offset="0%" stopColor="white" stopOpacity="0.25" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                  </radialGradient>
                </defs>
              </svg>
              {/* Child 2 — right, with blue umbrella, looking right (toward window) */}
              <svg className="absolute bottom-[14%] right-[15%]" width="22" height="28" viewBox="0 0 22 28" style={{ imageRendering: "pixelated" }}>
                {/* Umbrella */}
                <ellipse cx="11" cy="4" rx="9" ry="4.5" fill="#4488cc" />
                <ellipse cx="11" cy="4" rx="9" ry="4.5" fill="url(#umbrellaShine2)" />
                <line x1="11" y1="4" x2="11" y2="20" stroke="#6b4226" strokeWidth="1" />
                <path d="M11 20 Q13 22 11 23" fill="none" stroke="#6b4226" strokeWidth="0.8" />
                {/* Head */}
                <circle cx="11" cy="13" r="2.8" fill="#c68642" />
                {/* Hair — curly/short */}
                <rect x="8" y="10" width="6" height="2.5" rx="1.2" fill="#2a1a0a" />
                {/* Eyes looking at window */}
                <rect x="12" y="12.5" width="1" height="1" fill="#222" />
                {/* Body — blue raincoat */}
                <rect x="8" y="16" width="6" height="5" rx="1" fill="#3366aa" />
                {/* Legs + boots */}
                <rect x="9" y="21" width="2" height="3" fill="#3366aa" />
                <rect x="12" y="21" width="2" height="3" fill="#3366aa" />
                <rect x="8.5" y="24" width="3" height="2" rx="0.5" fill="#4488cc" />
                <rect x="11.5" y="24" width="3" height="2" rx="0.5" fill="#4488cc" />
                <defs>
                  <radialGradient id="umbrellaShine2" cx="40%" cy="30%">
                    <stop offset="0%" stopColor="white" stopOpacity="0.2" />
                    <stop offset="100%" stopColor="white" stopOpacity="0" />
                  </radialGradient>
                </defs>
              </svg>
              {/* Window divider (cross pane) */}
              <div className="absolute inset-0 border-r-2 border-[#5a6a7a]" style={{ width: "50%" }} />
              <div className="absolute inset-0 border-b-2 border-[#5a6a7a]" style={{ height: "50%" }} />
              {/* Rain drops on glass */}
              <svg className="absolute inset-0 w-full h-full" style={{ opacity: 0.15 }}>
                <circle cx="20%" cy="25%" r="1" fill="#aabbcc" />
                <circle cx="60%" cy="15%" r="1.2" fill="#aabbcc" />
                <circle cx="80%" cy="40%" r="0.8" fill="#aabbcc" />
                <circle cx="35%" cy="55%" r="1" fill="#aabbcc" />
                <circle cx="70%" cy="65%" r="1.1" fill="#aabbcc" />
                <circle cx="15%" cy="70%" r="0.9" fill="#aabbcc" />
                <circle cx="45%" cy="35%" r="1.3" fill="#aabbcc" />
                <circle cx="85%" cy="20%" r="0.7" fill="#aabbcc" />
              </svg>
            </div>
          </div>

          {/* Conference table — center */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ zIndex: 2 }}>
            <svg viewBox="0 0 80 40" className="w-32 h-16" style={{ imageRendering: "pixelated" }}>
              {/* Table shadow */}
              <rect x="4" y="4" width="76" height="36" rx="4" fill="rgba(0,0,0,0.1)" />
              {/* Table */}
              <rect x="0" y="0" width="80" height="36" rx="4" fill="#c8a06a" />
              <rect x="0" y="0" width="80" height="4" rx="4" fill="#d4ad78" />
              <rect x="2" y="4" width="76" height="28" fill="#dbb880" opacity="0.3" />
            </svg>
          </div>

          {/* Desks along the walls */}
          {agents.map((agent, i) => {
            const maxPerRow = Math.ceil(agents.length / 2);
            const row = i < maxPerRow ? 0 : 1;
            const col = row === 0 ? i : i - maxPerRow;
            const rowCount = row === 0 ? maxPerRow : agents.length - maxPerRow;
            const xStep = 70 / (rowCount + 1);
            const deskX = 15 + xStep * (col + 1);
            const deskY = row === 0 ? 32 : 72;
            return (
              <div key={`desk-${agent.id}`} className="absolute -translate-x-1/2" style={{ left: `${deskX}%`, top: `${deskY + 4}%`, zIndex: 3 }}>
                <svg viewBox="0 0 52 24" className="w-20 h-8" style={{ imageRendering: "pixelated" }}>
                  {/* Desk shadow */}
                  <rect x="3" y="3" width="49" height="8" rx="1" fill="rgba(0,0,0,0.08)" />
                  {/* Desk surface */}
                  <rect x="0" y="0" width="52" height="7" rx="1" fill="#a0784a" />
                  <rect x="0" y="0" width="52" height="3" rx="1" fill="#b8905a" />
                  {/* Drawers */}
                  <rect x="2" y="7" width="18" height="14" fill="#8b6a40" />
                  <rect x="3" y="8" width="16" height="5" fill="#9a7850" />
                  <rect x="9" y="10" width="4" height="1" fill="#c8a06a" />
                  <rect x="3" y="14" width="16" height="5" fill="#9a7850" />
                  <rect x="9" y="16" width="4" height="1" fill="#c8a06a" />
                  {/* Legs */}
                  <rect x="34" y="7" width="3" height="16" fill="#7a5c34" />
                  <rect x="47" y="7" width="3" height="16" fill="#7a5c34" />
                  {/* Monitor */}
                  <rect x="20" y="-11" width="18" height="11" rx="1" fill="#2a2a3a" />
                  <rect x="21" y="-10" width="16" height="9" fill="#3a5a7a" />
                  <rect x="27" y="0" width="4" height="2" fill="#444" />
                  {/* Chair */}
                  <rect x="24" y="22" width="12" height="3" rx="1" fill="#5a7090" />
                  <rect x="23" y="18" width="14" height="5" rx="1" fill="#6a80a0" />
                </svg>
              </div>
            );
          })}

          {/* Water cooler — left side */}
          <div className="absolute" style={{ left: "4%", top: "50%", zIndex: 3 }}>
            <svg viewBox="0 0 16 32" className="w-6 h-10" style={{ imageRendering: "pixelated" }}>
              <rect x="4" y="0" width="8" height="12" fill="#a8d8ea" opacity="0.6" />
              <rect x="4" y="0" width="8" height="4" fill="#c8e8f8" opacity="0.4" />
              <rect x="3" y="12" width="10" height="3" fill="#ccc" />
              <rect x="4" y="15" width="8" height="12" fill="#e8e8e8" />
              <rect x="5" y="16" width="6" height="4" fill="#ddd" />
              <rect x="3" y="27" width="10" height="2" fill="#aaa" />
              <rect x="4" y="29" width="3" height="3" fill="#888" />
              <rect x="9" y="29" width="3" height="3" fill="#888" />
              <rect x="1" y="18" width="3" height="3" fill="#4a90d9" rx="1" />
            </svg>
          </div>

          {/* Plant — bottom left */}
          <div className="absolute" style={{ left: "4%", bottom: "6%", zIndex: 3 }}>
            <svg viewBox="0 0 24 32" className="w-8 h-10" style={{ imageRendering: "pixelated" }}>
              {/* Pot */}
              <rect x="7" y="20" width="10" height="12" fill="#8b6a3a" />
              <rect x="6" y="19" width="12" height="3" fill="#a07840" />
              {/* Soil */}
              <rect x="8" y="19" width="8" height="2" fill="#5a4020" />
              {/* Leaves */}
              <rect x="9" y="8" width="6" height="12" fill="#2d7a2d" />
              <rect x="4" y="4" width="7" height="10" fill="#3a9a3a" />
              <rect x="13" y="5" width="7" height="9" fill="#3a9a3a" />
              <rect x="6" y="1" width="5" height="6" fill="#50b050" />
              <rect x="13" y="2" width="5" height="6" fill="#50b050" />
              <rect x="9" y="0" width="4" height="4" fill="#60c060" />
            </svg>
          </div>

          {/* Plant — top right corner */}
          <div className="absolute" style={{ right: "4%", top: "20%", zIndex: 3 }}>
            <svg viewBox="0 0 20 28" className="w-6 h-8" style={{ imageRendering: "pixelated" }}>
              <rect x="6" y="18" width="8" height="10" fill="#8b6a3a" />
              <rect x="5" y="17" width="10" height="2" fill="#a07840" />
              <rect x="7" y="6" width="6" height="12" fill="#2d7a2d" />
              <rect x="3" y="3" width="6" height="8" fill="#3a9a3a" />
              <rect x="11" y="4" width="6" height="7" fill="#3a9a3a" />
              <rect x="5" y="0" width="4" height="5" fill="#50b050" />
              <rect x="11" y="1" width="4" height="5" fill="#50b050" />
            </svg>
          </div>

          {/* Filing cabinet — right wall */}
          <div className="absolute" style={{ right: "4%", top: "42%", zIndex: 3 }}>
            <svg viewBox="0 0 16 28" className="w-5 h-8" style={{ imageRendering: "pixelated" }}>
              <rect x="0" y="0" width="16" height="28" fill="#b0a090" />
              <rect x="0" y="0" width="16" height="2" fill="#c0b0a0" />
              <rect x="1" y="3" width="14" height="7" fill="#a89880" />
              <rect x="5" y="5" width="6" height="2" fill="#c8b8a0" />
              <rect x="1" y="12" width="14" height="7" fill="#a89880" />
              <rect x="5" y="14" width="6" height="2" fill="#c8b8a0" />
              <rect x="1" y="21" width="14" height="7" fill="#a89880" />
              <rect x="5" y="23" width="6" height="2" fill="#c8b8a0" />
            </svg>
          </div>

          {/* Side table with vase — top left */}
          <div className="absolute" style={{ left: "4%", top: "20%", zIndex: 3 }}>
            <svg viewBox="0 0 20 24" className="w-6 h-7" style={{ imageRendering: "pixelated" }}>
              <rect x="0" y="6" width="20" height="5" fill="#a0784a" />
              <rect x="0" y="6" width="20" height="2" fill="#b8905a" />
              <rect x="2" y="11" width="3" height="13" fill="#7a5c34" />
              <rect x="15" y="11" width="3" height="13" fill="#7a5c34" />
              {/* Vase */}
              <rect x="7" y="1" width="6" height="6" fill="#d4d8e0" />
              <rect x="8" y="0" width="4" height="2" fill="#e0e4ec" />
              {/* Flower */}
              <rect x="8" y="-3" width="2" height="4" fill="#3a8a3a" />
              <rect x="7" y="-5" width="4" height="3" fill="#e06080" />
            </svg>
          </div>

          {/* Agents */}
          {agents.length === 0 ? (
            <div className="absolute inset-0 flex items-center justify-center">
              <p className="text-gray-600 text-xs">No agents yet. Create agents in the Agents page.</p>
            </div>
          ) : agents.map((agent, i) => {
            const pos = positions[agent.id];
            if (!pos) return null;
            const color = COLORS[i % COLORS.length];
            const isActive = chatAgent?.id === agent.id;
            const female = isFemale(agent.name);
            const isWalking = pos.state === "walking";
            const traits = parseTraits(agent.systemPrompt, agent.jobTitle, agent.name, color);
            return (
              <div
                key={agent.id}
                className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                style={{
                  left: `${pos.x}%`, top: `${pos.y}%`,
                  zIndex: isActive ? 30 : Math.round(pos.y),
                  transition: "left 100ms linear, top 100ms linear",
                }}
              >
                {/* Name + job title + model badge */}
                <div className={`mb-0.5 text-center transition-opacity ${hoveredId === agent.id || isActive ? "opacity-100" : "opacity-50"}`}>
                  <div className="flex items-center justify-center gap-0.5">
                    <ModelBadge model={agent.model} />
                    <div className="text-[9px] font-bold whitespace-nowrap" style={{ color }}>{agent.name}</div>
                  </div>
                  {agent.jobTitle && (
                    <div className="text-[7px] text-gray-500 whitespace-nowrap">{agent.jobTitle}</div>
                  )}
                </div>

                {/* Character */}
                <div
                  className={`cursor-pointer transition-transform ${isActive ? "scale-125" : "hover:scale-110"}`}
                  onMouseEnter={() => setHoveredId(agent.id)}
                  onMouseLeave={() => setHoveredId(null)}
                  onClick={() => isActive ? closeChat() : openChat(agent)}
                >
                  {isDog(agent)
                    ? <DogSprite color={color} frame={isWalking ? pos.walkFrame : 0} facing={pos.facing} />
                    : <CharacterSprite traits={traits} frame={isWalking ? pos.walkFrame : 0} facing={pos.facing} />
                  }
                </div>
                <div className="w-6 h-1.5 rounded-full bg-black/20 -mt-0.5" />
              </div>
            );
          })}
        </div>

        {/* Meeting Room — overlays the office when in meeting */}
        {inMeeting && (
          <div className="absolute inset-0 rounded-lg overflow-hidden" style={{
            background: "#d8ccb8",
            boxShadow: "inset 0 0 0 4px #6b7b8d, inset 0 0 0 6px #4a5568",
            zIndex: 40,
          }}>
            {/* Meeting room floor */}
            <div className="absolute inset-0 rounded-lg" style={{
              background: "repeating-conic-gradient(#d0c4ae 0% 25%, #d8ccb8 0% 50%) 0 0 / 40px 40px",
            }} />

            {/* Wall */}
            <div className="absolute top-0 left-0 right-0 h-[15%] rounded-t-lg" style={{
              background: "linear-gradient(180deg, #5a6a7a 0%, #6a7a8a 100%)",
            }}>
              <div className="absolute bottom-0 left-0 right-0 h-[4px] bg-[#4a5060]" />
              {/* Big window */}
              <div className="absolute top-[10%] left-[15%] w-[70%] h-[65%] rounded-sm overflow-hidden" style={{
                background: "linear-gradient(180deg, #87ceeb 0%, #aadcf0 100%)",
                border: "3px solid #5a6a7a",
              }}>
                <div className="absolute inset-0 border-r-2 border-[#5a6a7a]" style={{ width: "33%" }} />
                <div className="absolute inset-0 border-r-2 border-[#5a6a7a]" style={{ width: "66%" }} />
              </div>
              {/* "MEETING ROOM" sign */}
              <div className="absolute top-[15%] right-[4%] px-2 py-0.5 bg-[#f5f0e0] border border-[#8b7355] rounded-sm">
                <span className="text-[6px] font-bold text-[#5a4a30]">MEETING</span>
              </div>
            </div>

            {/* Big conference table */}
            <div className="absolute left-1/2 top-[52%] -translate-x-1/2 -translate-y-1/2" style={{ zIndex: 5 }}>
              <svg viewBox="0 0 160 80" className="w-64 h-32" style={{ imageRendering: "pixelated" }}>
                <ellipse cx="84" cy="44" rx="78" ry="38" fill="rgba(0,0,0,0.08)" />
                <ellipse cx="80" cy="40" rx="78" ry="38" fill="#b8905a" />
                <ellipse cx="80" cy="40" rx="74" ry="34" fill="#c8a06a" />
                <ellipse cx="80" cy="36" rx="74" ry="34" fill="#d4ad78" opacity="0.4" />
              </svg>
            </div>

            {/* Agents seated around table */}
            {agents.map((agent, i) => {
              const seat = getSeatPosition(i, agents.length);
              const color = COLORS[i % COLORS.length];
              const facingRight = seat.x < 50;
              const meetingTraits = parseTraits(agent.systemPrompt, agent.jobTitle, agent.name, color);
              return (
                <div
                  key={agent.id}
                  className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center"
                  style={{ left: `${seat.x}%`, top: `${seat.y}%`, zIndex: Math.round(seat.y) + 5 }}
                >
                  <div className="mb-0.5 text-center">
                    <div className="flex items-center justify-center gap-0.5">
                      <ModelBadge model={agent.model} />
                      <div className="text-[9px] font-bold whitespace-nowrap" style={{ color }}>{agent.name}</div>
                    </div>
                    {agent.jobTitle && <div className="text-[7px] text-gray-500 whitespace-nowrap">{agent.jobTitle}</div>}
                  </div>
                  {isDog(agent)
                    ? <DogSprite color={color} frame={0} facing={facingRight ? "right" : "left"} />
                    : <CharacterSprite traits={meetingTraits} frame={0} facing={facingRight ? "right" : "left"} />
                  }
                  <div className="w-6 h-1.5 rounded-full bg-black/15 -mt-0.5" />
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Right: Meeting log panel */}
      {inMeeting && (
        <div className="w-80 shrink-0 flex flex-col border-l border-white/10 pl-4">
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3 shrink-0">
            <div>
              <h2 className="font-bold text-sm">Meeting</h2>
              {meetingTopic && <p className="text-gray-500 text-[10px] truncate max-w-[200px]">{meetingTopic}</p>}
            </div>
            {meetingRunning && (
              <span className="text-[10px] text-green-400 animate-pulse">In progress...</span>
            )}
          </div>

          {/* Meeting log */}
          <div className="flex-1 overflow-y-auto space-y-3 pr-1">
            {meetingLog.length === 0 && !meetingRunning && (
              <p className="text-gray-600 text-xs text-center mt-8">Enter a topic to start the meeting</p>
            )}
            {meetingLog.map((entry, i) => (
              <div key={i}>
                <div className="flex items-center gap-1.5 mb-1">
                  <div className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.color }} />
                  <span className="text-xs font-bold" style={{ color: entry.color }}>{entry.agent}</span>
                </div>
                <div className="ml-3.5 text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">
                  {entry.text === "..." ? (
                    <span className="text-gray-500 animate-pulse">thinking...</span>
                  ) : entry.text}
                </div>
              </div>
            ))}
            <div ref={meetingEndRef} />
          </div>

          {/* Meeting input */}
          <form onSubmit={startMeeting} className="flex gap-2 items-center pt-3 border-t border-white/10 mt-2 shrink-0">
            <input
              ref={meetingInputRef}
              value={meetingInput}
              onChange={(e) => setMeetingInput(e.target.value)}
              onKeyDown={handleMeetingKeyDown}
              placeholder={meetingRunning ? "Meeting in progress..." : "Meeting topic..."}
              disabled={meetingRunning}
              className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-xs"
            />
            <button
              type="submit"
              disabled={meetingRunning || !meetingInput.trim()}
              className="px-3 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0 text-xs"
            >
              Start
            </button>
          </form>
        </div>
      )}

      {/* Right: Conversation panel */}
      {!inMeeting && chatAgent && (
        <div className="w-80 shrink-0 flex flex-col border-l border-white/10 pl-4">
          {/* Header */}
          <div className="flex items-center justify-between pb-3 border-b border-white/10 mb-3 shrink-0">
            <div>
              <h2 className="font-bold text-sm">{chatAgent.name}</h2>
              {chatAgent.jobTitle && <p className="text-gray-500 text-[10px]">{chatAgent.jobTitle}</p>}
            </div>
            <div className="flex gap-1">
              {messages.length > 0 && (
                <button
                  onClick={() => { setMessages([]); saveConversation(chatAgent.id, []); }}
                  className="text-[10px] text-gray-500 hover:text-white cursor-pointer px-1.5 py-0.5 rounded hover:bg-white/5"
                >
                  Clear
                </button>
              )}
              <button onClick={closeChat} className="text-gray-500 hover:text-white cursor-pointer p-0.5">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>

          {/* Messages — drop zone */}
          <div
            className={`flex-1 overflow-y-auto space-y-2 pr-1 relative rounded-lg transition-colors ${
              dragOver ? "bg-blue-500/5 ring-2 ring-blue-400/30 ring-inset" : ""
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleFileDrop}
          >
            {dragOver && (
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <div className="bg-blue-500/10 border border-dashed border-blue-400/40 rounded-lg px-4 py-3 text-center">
                  <p className="text-blue-400 text-[10px] font-medium">Drop file here</p>
                </div>
              </div>
            )}
            {messages.length === 0 && !dragOver && (
              <div className="text-center mt-8">
                <p className="text-gray-600 text-xs">Start a conversation with {chatAgent.name}</p>
                <p className="text-gray-700 text-[10px] mt-1">Drop a PDF or image to attach it</p>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[90%] px-3 py-2 rounded-xl text-xs whitespace-pre-wrap ${
                  msg.role === "user"
                    ? "bg-white/10 text-white rounded-br-sm"
                    : "bg-white/5 text-gray-200 rounded-bl-sm"
                }`}>
                  {msg.file && (
                    msg.file.mediaType.startsWith("image/") ? (
                      <img src={`data:${msg.file.mediaType};base64,${msg.file.base64}`} alt={msg.file.name} className="max-w-full max-h-32 rounded mb-1" />
                    ) : (
                      <div className="flex items-center gap-1.5 mb-1 px-1.5 py-1 bg-white/5 rounded">
                        <svg className="w-3 h-3 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                        </svg>
                        <span className="text-[10px] text-gray-300 truncate">{msg.file.name}</span>
                      </div>
                    )
                  )}
                  {msg.content && msg.content !== `[Attached: ${msg.file?.name}]` && msg.content}
                  {streaming && i === messages.length - 1 && msg.role === "assistant" && (
                    <span className="inline-block w-1 h-3 bg-white/40 ml-0.5 animate-pulse rounded-sm" />
                  )}
                </div>
              </div>
            ))}
            <div ref={messagesEndRef} />
          </div>

          {/* Pending file */}
          {pendingFile && (
            <div className="flex items-center gap-1.5 px-2 py-1.5 bg-white/5 border border-white/10 rounded-lg mt-1">
              {pendingFile.mediaType.startsWith("image/") ? (
                <img src={`data:${pendingFile.mediaType};base64,${pendingFile.base64}`} alt={pendingFile.name} className="w-8 h-8 rounded object-cover shrink-0" />
              ) : (
                <svg className="w-3 h-3 text-red-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                </svg>
              )}
              <span className="text-[10px] text-gray-300 truncate flex-1">{pendingFile.name}</span>
              <button onClick={() => setPendingFile(null)} className="text-gray-500 hover:text-white cursor-pointer">
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          )}

          {/* Input */}
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf,image/png,image/jpeg,image/gif,image/webp" onChange={handleFileInput} className="hidden" />
          <form onSubmit={handleSend} className="flex gap-2 items-center pt-3 border-t border-white/10 mt-2 shrink-0">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={streaming}
              className="text-gray-500 hover:text-white transition-colors cursor-pointer disabled:opacity-30 shrink-0"
              title="Attach file"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
              </svg>
            </button>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Type a message..."
              disabled={streaming}
              className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:border-white/30 text-xs"
            />
            <button
              type="submit"
              disabled={streaming || (!input.trim() && !pendingFile)}
              className="px-3 py-2 bg-white text-black font-medium rounded-lg hover:bg-gray-200 transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed shrink-0 text-xs"
            >
              {streaming ? "..." : "Send"}
            </button>
          </form>
        </div>
      )}

      {/* Toast notifications — fixed bottom center, liquid glass */}
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex flex-col items-center gap-2 pointer-events-none">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className="animate-toast-in pointer-events-auto rounded-2xl px-5 py-3 text-xs text-white/90 max-w-sm shadow-2xl"
            style={{
              background: "linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.04) 50%, rgba(255,255,255,0.07) 100%)",
              backdropFilter: "blur(24px) saturate(1.5)",
              WebkitBackdropFilter: "blur(24px) saturate(1.5)",
              border: "1px solid rgba(255,255,255,0.12)",
              boxShadow: "0 8px 32px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.08)",
            }}
          >
            <span className="font-medium text-white/70">{toast.agent}</span>{" "}
            <span className="text-white/60">{toast.text.split(": ").slice(1).join(": ")}</span>
          </div>
        ))}
      </div>

      <style>{`
        @keyframes toast-in {
          0% { opacity: 0; transform: translateY(20px) scale(0.95); }
          100% { opacity: 1; transform: translateY(0) scale(1); }
        }
        @keyframes toast-out {
          0% { opacity: 1; }
          100% { opacity: 0; transform: translateY(-8px); }
        }
        .animate-toast-in {
          animation: toast-in 0.3s ease-out, toast-out 0.5s ease-in 3.5s forwards;
        }
      `}</style>
    </div>
  );
}
