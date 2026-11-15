import React from 'react';
import {
  BarChart3,
  Binoculars,
  Droplets,
  FlaskConical,
  Leaf,
  RefreshCw,
  Sprout,
  Tractor,
  Wheat,
} from 'lucide-react';
import canopyWheatImg from '../../assets/images/crop_canopy_cinematic_1793374553402.jpg';
import { resolveCropThumbnail } from '../../lib/myFarmsEngine';
import { CALENDAR_CATEGORIES, CalendarCategory } from '../../lib/calendarEngine';

interface CategoryGlyphProps {
  category: CalendarCategory;
  className?: string;
  colorOverride?: string;
}

export const CalendarCategoryGlyph: React.FC<CategoryGlyphProps> = ({
  category,
  className = 'w-4 h-4',
  colorOverride,
}) => {
  const color = colorOverride ?? CALENDAR_CATEGORIES[category].accentHex;
  switch (category) {
    case 'planting':
      return <Leaf className={className} style={{ color }} strokeWidth={2.3} />;
    case 'irrigation':
      return (
        <Droplets
          className={className}
          style={{ color, fill: colorOverride ? 'none' : color }}
          strokeWidth={2}
        />
      );
    case 'soil_test':
      return <FlaskConical className={className} style={{ color }} strokeWidth={2.2} />;
    case 'scouting':
      return <Binoculars className={className} style={{ color }} strokeWidth={2.2} />;
    case 'harvest':
      return <Wheat className={className} style={{ color }} strokeWidth={2.2} />;
    case 'rotation_prep':
      return <RefreshCw className={className} style={{ color }} strokeWidth={2.3} />;
    case 'fertilizer':
      return <Sprout className={className} style={{ color }} strokeWidth={2.2} />;
    case 'analysis':
      return <BarChart3 className={className} style={{ color }} strokeWidth={2.2} />;
    case 'general':
    default:
      return <Tractor className={className} style={{ color }} strokeWidth={2.2} />;
  }
};

interface ActivityThumbnailProps {
  category: CalendarCategory;
  cropName?: string | null;
  size?: 'md' | 'sm';
}

export const CalendarActivityThumbnail: React.FC<ActivityThumbnailProps> = ({
  category,
  cropName,
  size = 'md',
}) => {
  const meta = CALENDAR_CATEGORIES[category];
  const dims = size === 'sm' ? 'w-10 h-10 rounded-[10px]' : 'w-[64px] h-[66px] rounded-[11px]';

  if (category === 'planting') {
    const cropLower = (cropName || '').toLowerCase();
    const imgSrc =
      !cropLower || cropLower.includes('wheat')
        ? canopyWheatImg
        : resolveCropThumbnail(cropName);
    return (
      <div
        className={`${dims} overflow-hidden shrink-0 border shadow-[inset_0_1px_1px_rgba(255,255,255,0.2)]`}
        style={{ borderColor: 'rgba(130, 212, 166, 0.36)' }}
      >
        <img
          src={imgSrc}
          alt={cropName || 'Crop stand'}
          className="w-full h-full object-cover"
        />
      </div>
    );
  }

  return (
    <div
      className={`${dims} shrink-0 flex items-center justify-center border shadow-[inset_0_1px_1px_rgba(255,255,255,0.12)]`}
      style={{
        background: meta.tileBg,
        borderColor: meta.tileBorder,
      }}
    >
      <CalendarCategoryGlyph
        category={category}
        className={size === 'sm' ? 'w-5 h-5' : 'w-8 h-8'}
      />
    </div>
  );
};
