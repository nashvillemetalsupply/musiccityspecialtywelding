/* THE MONUMENT — hand-drawn hero composition in the Luzern poster language.
   Crane-hung tube letters M·C·S carrying the shop's real services as hanging
   charms; a welder works the S from a chain-hung platform. Drawn by hand for
   this shop; single accent color reserved for fire. */
import type React from "react"

export function Monument({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 880 700"
      role="img"
      aria-label="Illustration: a crane lowers giant steel letters M C S while a welder joins them, the shop's work hanging from the letters"
      fill="none"
      stroke="var(--mn-ink)"
      strokeWidth="5"
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
    >
      {/* ---- sky: clouds and stars ---- */}
      <g strokeWidth="4">
        <path d="M84 120 q10 -18 30 -12 q6 -16 26 -10 q18 -8 26 8 q16 2 10 16 z" />
        <path d="M700 88 q8 -14 24 -10 q5 -13 21 -8 q15 -6 21 6 q13 2 8 13 z" />
        <path d="M120 320 q8 -14 24 -10 q5 -13 21 -8 q14 -6 20 6 q13 2 8 13 z" />
      </g>
      <g strokeWidth="4">
        <path d="M212 64 l4 12 12 4 -12 4 -4 12 -4 -12 -12 -4 12 -4 z" fill="var(--mn-ink)" stroke="none" />
        <path d="M640 190 l4 12 12 4 -12 4 -4 12 -4 -12 -12 -4 12 -4 z" fill="var(--mn-ink)" stroke="none" />
        <path d="M806 300 l4 12 12 4 -12 4 -4 12 -4 -12 -12 -4 12 -4 z" fill="var(--mn-fire)" stroke="none" />
        <path d="M64 226 l3 9 9 3 -9 3 -3 9 -3 -9 -9 -3 9 -3 z" fill="var(--mn-ink)" stroke="none" />
      </g>

      {/* ---- crane hook and spreader ---- */}
      <path d="M440 0 v34" strokeWidth="7" />
      <path d="M440 34 q26 4 26 26 q0 22 -26 24 q-18 -2 -18 -16" strokeWidth="7" />
      <circle cx="440" cy="30" r="7" fill="var(--mn-paper)" />
      {/* spreader beam */}
      <rect x="180" y="112" width="520" height="18" fill="var(--mn-ink)" stroke="none" />
      <circle cx="200" cy="121" r="3.5" fill="var(--mn-paper)" stroke="none" />
      <circle cx="440" cy="121" r="3.5" fill="var(--mn-paper)" stroke="none" />
      <circle cx="680" cy="121" r="3.5" fill="var(--mn-paper)" stroke="none" />
      {/* cables hook->beam */}
      <path d="M440 84 L300 112 M440 84 L580 112" strokeWidth="4" />

      {/* chains beam -> letters */}
      <g strokeWidth="4">
        <path d="M240 130 v14 m0 10 v14 M240 144 a5 7 0 0 0 0 10 M240 168 a5 7 0 0 0 0 10" />
        <path d="M440 130 v14 m0 10 v14 M440 144 a5 7 0 0 0 0 10 M440 168 a5 7 0 0 0 0 10" />
        <path d="M640 130 v14 m0 10 v14 M640 144 a5 7 0 0 0 0 10 M640 168 a5 7 0 0 0 0 10" />
      </g>

      {/* ---- the tube letters M C S with rivets ---- */}
      <g strokeWidth="34" stroke="var(--mn-ink)">
        <path d="M168 356 V208 L240 300 L312 208 V356" />
        <path d="M512 224 q-72 -24 -72 66 q0 90 72 66" />
        <path d="M700 214 q-64 -18 -64 30 q0 36 42 40 q46 4 46 44 q0 50 -70 32" />
      </g>
      {/* rivet dots along the tubes */}
      <g fill="var(--mn-paper)" stroke="none">
        <circle cx="168" cy="240" r="5" /><circle cx="168" cy="300" r="5" /><circle cx="168" cy="350" r="5" />
        <circle cx="240" cy="292" r="5" />
        <circle cx="312" cy="240" r="5" /><circle cx="312" cy="300" r="5" /><circle cx="312" cy="350" r="5" />
        <circle cx="452" cy="290" r="5" /><circle cx="482" cy="222" r="5" /><circle cx="482" cy="352" r="5" />
        <circle cx="648" cy="238" r="5" /><circle cx="668" cy="284" r="5" /><circle cx="688" cy="352" r="5" />
      </g>

      {/* ---- hanging service charms ---- */}
      {/* boat from M left */}
      <path d="M168 374 v52" strokeWidth="3" />
      <path d="M132 426 h72 l-12 22 h-48 z" fill="var(--mn-paper)" />
      <path d="M168 426 v-14 l20 14" strokeWidth="4" />
      {/* wrench from M right */}
      <path d="M312 374 v58" strokeWidth="3" />
      <path d="M312 432 a10 10 0 1 1 -14 14 l-6 22 a8 8 0 1 0 12 10 l16 -20 a10 10 0 1 0 -8 -26 z" transform="rotate(18 312 456)" fill="var(--mn-paper)" />
      {/* mailbox from C */}
      <path d="M440 380 v46" strokeWidth="3" />
      <path d="M410 426 h60 v34 h-60 z" fill="var(--mn-paper)" />
      <path d="M410 426 a30 17 0 0 1 60 0" fill="var(--mn-paper)" />
      <path d="M470 434 h12 v-16" strokeWidth="4" stroke="var(--mn-fire)" />
      <path d="M440 460 v22 M428 482 h24" strokeWidth="4" />
      {/* planter with sprout from S */}
      <path d="M610 380 v44" strokeWidth="3" />
      <path d="M584 424 h52 l-8 34 h-36 z" fill="var(--mn-paper)" />
      <path d="M610 424 v-16 q-14 -4 -12 -18 q14 2 12 18 q2 -16 16 -18 q0 16 -16 18" strokeWidth="4" />

      {/* ---- welder on chain-hung platform, working the S ---- */}
      {/* platform chains from S */}
      <g strokeWidth="3.6">
        <path d="M712 366 l30 66 M770 300 l30 132" />
      </g>
      {/* platform */}
      <rect x="716" y="432" width="120" height="14" fill="var(--mn-ink)" stroke="none" />
      <circle cx="728" cy="439" r="3" fill="var(--mn-paper)" stroke="none" />
      <circle cx="824" cy="439" r="3" fill="var(--mn-paper)" stroke="none" />
      {/* welder: boots, legs, body, helmet, arms + torch toward S bottom */}
      <path d="M760 432 v-26 M778 432 v-26" strokeWidth="7" />
      <path d="M752 432 h14 M772 432 h14" strokeWidth="6" />
      <path d="M756 406 q-4 -38 22 -40 q20 2 18 30 l-4 12" strokeWidth="7" fill="none" />
      {/* helmet */}
      <path d="M756 344 q-2 -26 22 -26 q24 0 22 26 q2 16 -10 20 h-24 q-12 -4 -10 -20 z" fill="var(--mn-paper)" />
      <rect x="762" y="342" width="32" height="8" rx="2" fill="var(--mn-ink)" stroke="none" />
      {/* arm + torch */}
      <path d="M760 380 q-22 4 -34 -12" strokeWidth="7" />
      <path d="M726 368 l-14 -10" strokeWidth="6" />
      <path d="M712 358 l-8 -6 6 -8 8 6 z" fill="var(--mn-paper)" strokeWidth="4" />
      {/* fire: the only hot color */}
      <g stroke="var(--mn-fire)" strokeWidth="4.5">
        <path d="M700 344 l-16 -8 M704 336 l-10 -16 M712 332 l-2 -18 M694 352 l-20 2" />
      </g>
      <circle cx="704" cy="346" r="5" fill="var(--mn-fire)" stroke="none" />

      {/* ---- ground: bolted baseplate ---- */}
      <rect x="36" y="612" width="808" height="22" fill="var(--mn-ink)" stroke="none" />
      <g fill="var(--mn-paper)" stroke="none">
        <circle cx="70" cy="623" r="4" /><circle cx="190" cy="623" r="4" /><circle cx="310" cy="623" r="4" />
        <circle cx="430" cy="623" r="4" /><circle cx="550" cy="623" r="4" /><circle cx="670" cy="623" r="4" />
        <circle cx="790" cy="623" r="4" />
      </g>
      {/* stray nuts and a bolt on the floor */}
      <g strokeWidth="4">
        <path d="M120 596 l8 -5 8 5 v9 l-8 5 -8 -5 z" />
        <circle cx="128" cy="600" r="3" fill="var(--mn-ink)" stroke="none" />
        <path d="M586 592 h26 M592 592 v-8 h14 v8" strokeWidth="4" />
        <path d="M262 598 l7 -4 7 4 v8 l-7 4 -7 -4 z" />
      </g>
      {/* shadow under welder platform */}
      <path d="M726 652 h100" strokeWidth="6" opacity="0.25" />
      <path d="M150 652 h180 M400 652 h120" strokeWidth="6" opacity="0.18" />
    </svg>
  )
}
