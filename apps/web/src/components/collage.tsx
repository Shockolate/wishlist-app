/** A small board of example gifts. Decoration only: hidden from assistive tech, and on phones. */
const TILES = [
  { place: 'col-[1/4] row-[1/5]', tone: 'bg-[#d8ccbe]', label: 'Linen apron' },
  { place: 'col-[4/7] row-[1/4]', tone: 'bg-[#c3cdb5]', label: 'Fig tree' },
  { place: 'col-[4/7] row-[4/7]', tone: 'bg-[#e2d3c6]', label: 'Camp mug' },
  { place: 'col-[1/3] row-[5/8]', tone: 'bg-[#bfc6b6]', label: 'Wool socks' },
  { place: 'col-[3/4] row-[5/8]', tone: 'bg-[#c9c4b4]', label: null },
  { place: 'col-[1/4] row-[8/9]', tone: 'bg-[#ddd3c7]', label: null },
] as const;

export function Collage() {
  return (
    <div
      aria-hidden="true"
      className="hidden min-w-0 flex-[1_1_480px] auto-rows-[72px] grid-cols-6 gap-3.5 md:grid"
    >
      {TILES.map((tile, index) => (
        <div key={index} className={`relative rounded-card ${tile.place} ${tile.tone}`}>
          {tile.label ? (
            <span className="absolute bottom-3 left-3 rounded-full bg-card px-2.5 py-1 text-[13px]">
              {tile.label}
            </span>
          ) : null}
        </div>
      ))}
      <div className="col-[4/7] row-[7/9] flex items-end rounded-card border border-border bg-card p-4">
        <span className="font-display text-[28px] italic leading-none">Pottery class for two</span>
      </div>
    </div>
  );
}
