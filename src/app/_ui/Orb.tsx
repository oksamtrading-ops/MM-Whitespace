/**
 * The full stop as an object: a matte satin sphere in the brand green, lit
 * from the upper left, sitting on the ground with a soft contact shadow.
 *
 * The same drawing as public/brand/full-stop-3d.svg. Nothing in it is a hue
 * Deloitte does not own: the shading is the green toward black, the
 * highlight is white at low opacity, and the shadow is black. Decorative
 * everywhere it appears (sign-in, empty states, loading), so it is hidden
 * from assistive technology, and hidden under forced colours and in print.
 */
export default function Orb({ className = "", size = 160 }: { className?: string; size?: number }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 160 160" aria-hidden="true" focusable="false">
      <defs>
        <radialGradient id="orb-body" cx="36%" cy="30%" r="72%">
          <stop offset="0" stopColor="#C4D600" />
          <stop offset=".28" stopColor="#86BC25" />
          <stop offset=".78" stopColor="#26890D" />
          <stop offset="1" stopColor="#000000" />
        </radialGradient>
        <radialGradient id="orb-spec" cx="33%" cy="26%" r="22%">
          <stop offset="0" stopColor="#FFFFFF" stopOpacity=".55" />
          <stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
        </radialGradient>
        <radialGradient id="orb-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#000000" stopOpacity=".55" />
          <stop offset="1" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse cx="84" cy="138" rx="46" ry="9" fill="url(#orb-shadow)" />
      <circle cx="76" cy="76" r="56" fill="url(#orb-body)" />
      <circle cx="76" cy="76" r="56" fill="url(#orb-spec)" />
    </svg>
  );
}
