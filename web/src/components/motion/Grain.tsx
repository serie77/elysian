/** Film grain over everything: one static SVG turbulence tile at plain low alpha, the cheapest thing a full-screen layer can be. */
export function Grain() {
  return <div className="grain pointer-events-none fixed inset-0 z-[90]" aria-hidden />;
}
