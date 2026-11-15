import React, { useEffect, useRef, useState } from 'react';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Cloud,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSnow,
  CloudSun,
  Home,
  Layers,
  Sun,
} from 'lucide-react';
import { useDisplayPrefs } from '../../context/DisplayPrefsContext';
import type { CalendarFarmOption, FarmWeatherSummary } from '../../types/calendar';

interface CalendarHeaderProps {
  farms: CalendarFarmOption[];
  selectedFarmId: string; // farm ID or 'all'
  selectedFieldId: string; // field ID or 'all'
  onSelectFarm: (farmId: string) => void;
  onSelectField: (fieldId: string) => void;
  weather: FarmWeatherSummary | null;
  loading: boolean;
}

function WeatherGlyph({ code, available }: { code: number | null | undefined; available: boolean }) {
  if (!available || code === null || code === undefined) {
    return <Cloud className="w-8 h-8 text-[#9EC3CC] shrink-0" strokeWidth={2} />;
  }
  if (code === 0 || code === 1) {
    return (
      <Sun
        className="w-8 h-8 sm:w-9 sm:h-9 text-[#F9C63D] shrink-0"
        style={{
          fill: '#F9C63D',
          filter: 'drop-shadow(0 0 10px rgba(249, 198, 61, 0.45))',
        }}
        strokeWidth={2}
      />
    );
  }
  if (code === 2) {
    return (
      <CloudSun
        className="w-8 h-8 sm:w-9 sm:h-9 text-[#F9C63D] shrink-0"
        style={{ filter: 'drop-shadow(0 0 8px rgba(249, 198, 61, 0.35))' }}
        strokeWidth={2}
      />
    );
  }
  if (code === 45 || code === 48) {
    return <CloudFog className="w-8 h-8 text-[#9EC3CC] shrink-0" strokeWidth={2} />;
  }
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) {
    return <CloudRain className="w-8 h-8 text-[#38BDF8] shrink-0" strokeWidth={2} />;
  }
  if (code >= 71 && code <= 86) {
    return <CloudSnow className="w-8 h-8 text-[#BAE6FD] shrink-0" strokeWidth={2} />;
  }
  if (code >= 95) {
    return <CloudLightning className="w-8 h-8 text-[#FBBF24] shrink-0" strokeWidth={2} />;
  }
  return <Cloud className="w-8 h-8 text-[#C8DCE2] shrink-0" strokeWidth={2} />;
}

export const CalendarHeader: React.FC<CalendarHeaderProps> = ({
  farms,
  selectedFarmId,
  selectedFieldId,
  onSelectFarm,
  onSelectField,
  weather,
  loading,
}) => {
  const { tempUnit, windUnit } = useDisplayPrefs();
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, []);

  const selectedFarm =
    selectedFarmId === 'all' ? null : farms.find((f) => f.id === selectedFarmId) ?? farms[0] ?? null;

  const selectedField =
    selectedFarm && selectedFieldId !== 'all'
      ? selectedFarm.fields.find((fld) => fld.id === selectedFieldId) ?? null
      : null;

  const selectorLabel =
    selectedFarmId === 'all'
      ? 'All Farms'
      : selectedField
        ? `${selectedFarm?.name || 'Farm'} · ${selectedField.name}`
        : selectedFarm?.name || 'Select Farm';

  const hasTemp = Boolean(weather && weather.available && weather.temp_c !== null);
  const displayTemp =
    hasTemp && weather && weather.temp_c !== null
      ? tempUnit === 'F'
        ? `${Math.round((weather.temp_c * 9) / 5 + 32)}°F`
        : `${Math.round(weather.temp_c)}°C`
      : loading
        ? '…'
        : '--°';

  const displayWind =
    hasTemp && weather && weather.wind_kmh !== null
      ? windUnit === 'mph'
        ? `${Math.round(weather.wind_kmh * 0.621371)} mph`
        : `${Math.round(weather.wind_kmh)} km/h`
      : '';

  const conditionText = hasTemp
    ? `${
        weather!.condition_label === 'Sunny' || weather!.condition_label === 'Mainly clear'
          ? 'Clear'
          : weather!.condition_label
      }${displayWind ? ` · ${displayWind}` : ''}`
    : loading
      ? 'Loading weather…'
      : weather?.condition_label || 'Weather unavailable';

  return (
    <section className="relative z-40 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 sm:gap-5">
      {/* Left Title Group */}
      <div className="flex items-center gap-4 sm:gap-5 min-w-0">
        <div
          className="w-13 h-13 sm:w-[62px] sm:h-[62px] rounded-2xl flex items-center justify-center shrink-0"
          style={{
            background: 'rgba(14, 58, 48, 0.42)',
            border: '1px solid rgba(56, 189, 206, 0.42)',
            boxShadow: '0 0 26px rgba(34, 240, 142, 0.22)',
          }}
        >
          <CalendarDays
            className="w-9 h-9 sm:w-11 sm:h-11 text-[#22F08E]"
            style={{ filter: 'drop-shadow(0 0 12px rgba(34, 240, 142, 0.55))' }}
            strokeWidth={2}
          />
        </div>
        <div className="min-w-0">
          <h1 className="text-[28px] sm:text-[36px] lg:text-[40px] font-extrabold tracking-[-0.025em] leading-[1.1] text-[#F5F8FA]">
            Calendar &amp; Actions
          </h1>
          <p className="mt-1 text-[14.5px] sm:text-[17px] lg:text-[18.5px] font-normal text-[#D1DCE0] leading-snug">
            Plan, track and manage your farm activities
          </p>
        </div>
      </div>

      {/* Right Control Cluster: Farm & Field Selector + Live Weather Card (No Profile Icon) */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-3 shrink-0">
        {/* Farm + Field Scope Pill (Home Page 2 Glassmorphism) */}
        <div className="relative" ref={dropdownRef}>
          <button
            type="button"
            onClick={() => setDropdownOpen((v) => !v)}
            aria-haspopup="listbox"
            aria-expanded={dropdownOpen}
            className="fs-cal-panel fs-cal-subcard-interactive h-[60px] sm:h-[64px] min-w-[220px] max-w-[310px] !rounded-[20px] px-4 flex items-center justify-between gap-3 cursor-pointer"
          >
            <span className="flex items-center gap-2.5 min-w-0">
              <Home className="w-5 h-5 text-[#22F08E] shrink-0" strokeWidth={2.2} />
              <span className="text-[14.5px] sm:text-[15.5px] font-semibold text-[#EEF4F6] truncate">
                {selectorLabel}
              </span>
            </span>
            <ChevronDown
              className={`w-4 h-4 text-[#C4D6DC] shrink-0 transition-transform duration-200 ${
                dropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {dropdownOpen && (
            <div
              role="listbox"
              aria-label="Select farm or field scope"
              className="fs-cal-panel absolute left-0 sm:right-0 sm:left-auto top-[70px] z-50 w-[300px] !rounded-[20px] p-2.5 space-y-2 shadow-2xl"
              style={{ backgroundColor: 'rgba(6, 26, 36, 0.94)' }}
            >
              {/* All Farms option */}
              {farms.length > 1 && (
                <button
                  type="button"
                  role="option"
                  aria-selected={selectedFarmId === 'all'}
                  onClick={() => {
                    onSelectFarm('all');
                    onSelectField('all');
                    setDropdownOpen(false);
                  }}
                  className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                    selectedFarmId === 'all'
                      ? 'bg-[#20F69A]/16 border border-[#20F69A]/45 text-white'
                      : 'hover:bg-white/[0.07] border border-transparent text-[#D6E6EA]'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <Layers className="w-4 h-4 text-[#38BDF8] shrink-0" />
                    <div className="min-w-0">
                      <div className="text-[13.5px] font-bold truncate">All Farms</div>
                      <div className="text-[11px] text-[#9BB7BE] truncate">
                        Unified schedule across {farms.length} farms
                      </div>
                    </div>
                  </div>
                  {selectedFarmId === 'all' && <Check className="w-4 h-4 text-[#20F69A] shrink-0" />}
                </button>
              )}

              {/* Individual Farms */}
              <div className="space-y-1 max-h-[220px] overflow-y-auto fs-thin-scroll">
                {farms.map((farm) => {
                  const isSelected = selectedFarmId === farm.id;
                  return (
                    <button
                      key={farm.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onSelectFarm(farm.id);
                        onSelectField('all');
                        if (farm.fields.length <= 1) {
                          setDropdownOpen(false);
                        }
                      }}
                      className={`w-full px-3 py-2.5 rounded-xl flex items-center justify-between gap-2 text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[#20F69A]/16 border border-[#20F69A]/45 text-white'
                          : 'hover:bg-white/[0.07] border border-transparent text-[#D6E6EA]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="text-[13.5px] font-semibold truncate">{farm.name}</div>
                        <div className="text-[11.5px] text-[#9BB7BE] truncate">
                          {farm.primary_crop || 'Mixed crops'} · {farm.region_label}
                        </div>
                      </div>
                      {isSelected && <Check className="w-4 h-4 text-[#20F69A] shrink-0" />}
                    </button>
                  );
                })}
              </div>

              {/* Field Filter Pills for Selected Farm */}
              {selectedFarm && selectedFarm.fields.length > 0 && (
                <div className="pt-2 border-t border-[#38BDCE]/25 space-y-1.5">
                  <div className="px-1 text-[11px] font-bold uppercase tracking-wider text-[#9BB7BE]">
                    Filter Field · {selectedFarm.name}
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectField('all');
                        setDropdownOpen(false);
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold transition-colors cursor-pointer ${
                        selectedFieldId === 'all'
                          ? 'bg-[#20F69A] text-[#032719] font-bold'
                          : 'fs-cal-subcard text-[#D6E6EA] hover:bg-white/10'
                      }`}
                    >
                      All Fields
                    </button>
                    {selectedFarm.fields.map((fld) => (
                      <button
                        key={fld.id}
                        type="button"
                        onClick={() => {
                          onSelectField(fld.id);
                          setDropdownOpen(false);
                        }}
                        className={`px-2.5 py-1 rounded-lg text-[11.5px] font-semibold transition-colors cursor-pointer ${
                          selectedFieldId === fld.id
                            ? 'bg-[#20F69A] text-[#032719] font-bold'
                            : 'fs-cal-subcard text-[#D6E6EA] hover:bg-white/10'
                        }`}
                      >
                        {fld.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Live Weather Card (Home Page 2 Glassmorphism) */}
        <div
          className="fs-cal-panel h-[60px] sm:h-[64px] min-w-[185px] max-w-[270px] !rounded-[20px] px-4 flex items-center gap-3"
          title={weather?.error ? `Weather status: ${weather.error}` : undefined}
        >
          <WeatherGlyph code={weather?.weather_code} available={Boolean(weather?.available)} />
          <div className="min-w-0 leading-tight">
            <div className="text-[20px] sm:text-[22px] font-extrabold text-[#F5F8FA] tabular-nums tracking-tight">
              {displayTemp}
            </div>
            <div className="text-[11.5px] sm:text-[12px] text-[#C5D5D9] truncate tabular-nums">
              {conditionText}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
