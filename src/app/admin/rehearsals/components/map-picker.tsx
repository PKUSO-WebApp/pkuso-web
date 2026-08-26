"use client";

import React from "react";

const TMAP_KEY = process.env.NEXT_PUBLIC_TENCENT_MAP_KEY ?? "";

type LatLng = { lat: number; lng: number };

type TMapLatLngLike = { lat: number; lng: number };

type TMapMapInstance = {
  on: (event: string, handler: (e: unknown) => void) => void;
  destroy: () => void;
  setCenter: (center: TMapLatLngLike) => void;
};

type TMapMarkerInstance = {
  on: (event: string, handler: (e: unknown) => void) => void;
  updateGeometries: (geometries: Array<{ id: string; position: TMapLatLngLike }>) => void;
  removeGeometries: (ids: string[]) => void;
};

type TMapNamespace = {
  Map: new (el: HTMLElement, opts: { center: TMapLatLngLike; zoom: number }) => TMapMapInstance;
  LatLng: new (lat: number, lng: number) => TMapLatLngLike;
  MultiMarker: new (opts: {
    map: unknown;
    geometries: Array<{
      id: string;
      position: TMapLatLngLike;
      enableDrag?: boolean;
    }>;
  }) => TMapMarkerInstance;
};

declare global {
  interface Window {
    TMap?: TMapNamespace;
  }
}

let tmapLoader: Promise<TMapNamespace> | null = null;

function loadTMap(): Promise<TMapNamespace> {
  if (window.TMap) return Promise.resolve(window.TMap);
  if (tmapLoader) return tmapLoader;
  tmapLoader = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://map.qq.com/api/gljs?v=1.exp&key=${encodeURIComponent(TMAP_KEY)}`;
    script.async = true;
    script.onload = () => {
      if (window.TMap) resolve(window.TMap);
      else {
        tmapLoader = null; // 允许下次重试
        reject(new Error("TMap failed to initialize"));
      }
    };
    script.onerror = () => {
      tmapLoader = null; // 允许下次重试
      reject(new Error("Failed to load Tencent Map JSAPI"));
    };
    document.head.appendChild(script);
  });
  return tmapLoader;
}

/* ---- 地点搜索：腾讯位置服务 WebService 关键词建议接口（JSONP，无 CORS 限制） ---- */

type SugItem = {
  title: string;
  address?: string;
  lat: number;
  lng: number;
};

type SugResponse = {
  status: number;
  message?: string;
  data?: Array<{
    title?: string;
    address?: string;
    location?: { lat: number; lng: number };
  }>;
};

let jsonpSeq = 0;

function jsonpRequest(url: string): Promise<SugResponse> {
  return new Promise((resolve, reject) => {
    const cbName = `__tmapSug_${Date.now()}_${++jsonpSeq}`;
    const script = document.createElement("script");
    const w = window as unknown as Record<string, unknown>;
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("suggestion timeout"));
    }, 5000);
    function cleanup() {
      clearTimeout(timer);
      delete w[cbName];
      script.remove();
    }
    w[cbName] = (data: SugResponse) => {
      cleanup();
      resolve(data);
    };
    script.src = `${url}${url.includes("?") ? "&" : "?"}output=jsonp&callback=${cbName}`;
    script.onerror = () => {
      cleanup();
      reject(new Error("suggestion request failed"));
    };
    document.head.appendChild(script);
  });
}

async function searchPlace(keyword: string): Promise<SugItem[]> {
  const url =
    `https://apis.map.qq.com/ws/place/v1/suggestion/?keyword=${encodeURIComponent(keyword)}` +
    `&key=${encodeURIComponent(TMAP_KEY)}`;
  const res = await jsonpRequest(url);
  if (res.status !== 0) throw new Error(res.message ?? "suggestion error");
  return (res.data ?? [])
    .filter((d) => d.location && typeof d.location.lat === "number")
    .slice(0, 8)
    .map((d) => ({
      title: d.title ?? "未命名地点",
      address: d.address,
      lat: d.location!.lat,
      lng: d.location!.lng,
    }));
}

type Props = {
  lat: number | null;
  lng: number | null;
  disabled?: boolean;
  onPick: (lat: number | null, lng: number | null) => void;
};

/**
 * 腾讯位置服务 JSAPI GL 选点组件
 *
 * - 点击地图 / 拖拽标记选点（GCJ-02，与微信 wx.getLocation 一致）
 * - 「使用当前位置」按钮走浏览器 Geolocation
 * - Key 缺失或脚本加载失败时降级为手填经纬度
 */
export function MapPicker({ lat, lng, disabled = false, onPick }: Props) {
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const mapRef = React.useRef<TMapMapInstance | null>(null);
  const markerRef = React.useRef<TMapMarkerInstance | null>(null);
  const pickRef = React.useRef(onPick);
  React.useEffect(() => {
    pickRef.current = onPick;
  }, [onPick]);

  const [loadError, setLoadError] = React.useState(false);
  const [locating, setLocating] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [results, setResults] = React.useState<SugItem[]>([]);
  const [searching, setSearching] = React.useState(false);
  const [searchError, setSearchError] = React.useState(false);

  // 点选候选项后回填标题时置位，搜索 effect 消费后跳过，避免回填触发多余请求
  const suppressSearchRef = React.useRef(false);

  // 关键词搜索：350ms 防抖，JSONP 建议接口（setState 均在定时器回调内，避免同步级联渲染）
  React.useEffect(() => {
    const kw = query.trim();
    let cancelled = false;
    const timer = setTimeout(() => {
      if (cancelled) return;
      if (suppressSearchRef.current) {
        suppressSearchRef.current = false;
        return;
      }
      if (!kw || !TMAP_KEY) {
        setResults([]);
        setSearchError(false);
        setSearching(false);
        return;
      }
      setSearching(true);
      setSearchError(false);
      searchPlace(kw)
        .then((items) => {
          if (!cancelled) {
            setResults(items);
            setSearching(false);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setResults([]);
            setSearchError(true); // 配额超限/白名单不符等：显式提示，避免被误读为「无结果」
            setSearching(false);
          }
        });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const pickResult = (item: SugItem) => {
    suppressSearchRef.current = true;
    onPick(item.lat, item.lng);
    setQuery(item.title);
    setResults([]);
    setSearchError(false);
  };

  React.useEffect(() => {
    let cancelled = false;
    const container = containerRef.current;
    if (!container || !TMAP_KEY || disabled) return;

    loadTMap()
      .then((TMap) => {
        if (cancelled || !containerRef.current) return;
        setLoadError(false);

        const center = new TMap.LatLng(lat ?? 39.9042, lng ?? 116.4074);
        mapRef.current = new TMap.Map(containerRef.current, { center, zoom: 16 });
        mapRef.current.on("click", (e: unknown) => {
          const ll = (e as { latLng?: TMapLatLngLike }).latLng;
          if (ll) pickRef.current(ll.lat, ll.lng);
        });

        markerRef.current = new TMap.MultiMarker({
          map: mapRef.current,
          geometries:
            lat != null && lng != null
              ? [{ id: "pin", position: new TMap.LatLng(lat, lng), enableDrag: true }]
              : [],
        });
        markerRef.current.on("dragend", (e: unknown) => {
          const pos = (e as { geometry?: { position?: TMapLatLngLike } }).geometry?.position;
          if (pos) pickRef.current(pos.lat, pos.lng);
        });
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });

    return () => {
      cancelled = true;
      mapRef.current?.destroy();
      mapRef.current = null;
      markerRef.current = null;
    };
    // 仅在挂载/禁用态变化时初始化；lat/lng 变化经下方 effect 同步标记
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  React.useEffect(() => {
    const TMap = window.TMap;
    if (!TMap || !markerRef.current) return;
    if (lat == null || lng == null) {
      // 坐标被清空：移除大头针，与「尚未选择签到点」文案保持一致
      try {
        markerRef.current.removeGeometries(["pin"]);
      } catch {
        /* 几何不存在时忽略 */
      }
      return;
    }
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    markerRef.current.updateGeometries([{ id: "pin", position: new TMap.LatLng(lat, lng) }]);
    mapRef.current?.setCenter(new TMap.LatLng(lat, lng));
  }, [lat, lng]);

  /** 手填输入统一出口：空串→null；非有限数（NaN/Infinity）→null，杜绝脏值入库 */
  const pickManual = (rawLat: string, rawLng: string) => {
    const toNum = (s: string): number | null => {
      if (s === "") return null;
      const n = Number(s);
      return Number.isFinite(n) ? n : null;
    };
    onPick(toNum(rawLat), toNum(rawLng));
  };

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      alert("当前浏览器不支持定位");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        // 浏览器 Geolocation 返回 WGS-84，中国境内需转 GCJ-02 再回填
        const gcj = wgs84ToGcj02(pos.coords.latitude, pos.coords.longitude);
        onPick(gcj.lat, gcj.lng);
      },
      () => {
        setLocating(false);
        alert("获取当前位置失败，请在地图上点选");
      },
      { enableHighAccuracy: true, timeout: 8000 },
    );
  };

  const showFallback = !TMAP_KEY || loadError;

  return (
    <div className="space-y-2">
      {TMAP_KEY && (
        <div className="relative">
          <input
            type="text"
            value={query}
            disabled={disabled}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索地点，如：北京大学新太阳学生中心"
            className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
          />
          {(results.length > 0 || searchError || (searching && query.trim())) && (
            <div
              className="absolute left-0 right-0 top-full mt-1 max-h-44 w-full overflow-y-auto rounded-xl border border-border bg-surface shadow-sm"
              style={{ zIndex: 3000 }}
            >
              {searching && results.length === 0 && (
                <p className="px-3 py-2 text-xs text-text-muted">搜索中…</p>
              )}
              {searchError && !searching && results.length === 0 && (
                <p className="px-3 py-2 text-xs text-danger">
                  搜索失败（配额或网络问题），请手填经纬度
                </p>
              )}
              {results.map((item) => (
                <button
                  key={`${item.lat},${item.lng},${item.title}`}
                  type="button"
                  disabled={disabled}
                  onClick={() => pickResult(item)}
                  className="block w-full px-3 py-2 text-left hover:bg-muted"
                >
                  <span className="block text-xs text-text">{item.title}</span>
                  {item.address && (
                    <span className="mt-0.5 block truncate text-xs text-text-muted">
                      {item.address}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {!showFallback && (
        <div
          ref={containerRef}
          className="h-56 w-full overflow-hidden rounded-xl border border-border"
        />
      )}
      {showFallback && (
        <p className="rounded-xl bg-muted px-3 py-2 text-xs text-text-muted">
          地图组件不可用（未配置 Key 或加载失败），可直接手填经纬度。
        </p>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={useMyLocation}
          disabled={disabled || locating}
          className="rounded-full border border-border bg-surface px-3 py-1.5 text-xs text-text hover:bg-muted disabled:opacity-60"
        >
          {locating ? "定位中…" : "使用当前位置"}
        </button>
        <span className="text-xs text-text-muted">
          {lat != null && lng != null
            ? `已选：${lat.toFixed(6)}, ${lng.toFixed(6)}`
            : "尚未选择签到点"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          type="number"
          step="any"
          value={lat ?? ""}
          disabled={disabled}
          onChange={(e) => pickManual(e.target.value, lng != null ? String(lng) : "")}
          placeholder="纬度 latitude"
          className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
        />
        <input
          type="number"
          step="any"
          value={lng ?? ""}
          disabled={disabled}
          onChange={(e) => pickManual(lat != null ? String(lat) : "", e.target.value)}
          placeholder="经度 longitude"
          className="w-full rounded-xl border border-border bg-muted px-3 py-2 text-xs text-text outline-none focus:border-text-muted"
        />
      </div>
    </div>
  );
}

const PI = Math.PI;
const A = 6378245.0;
const EE = 0.00669342162296594323;

function outOfChina(lat: number, lng: number): boolean {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271;
}

/** WGS-84 → GCJ-02（仅中国境内有偏移；境外原样返回） */
export function wgs84ToGcj02(wgsLat: number, wgsLng: number): LatLng {
  if (outOfChina(wgsLat, wgsLng)) return { lat: wgsLat, lng: wgsLng };
  let dLat = transformLat(wgsLng - 105.0, wgsLat - 35.0);
  let dLng = transformLng(wgsLng - 105.0, wgsLat - 35.0);
  const radLat = (wgsLat / 180.0) * PI;
  let magic = Math.sin(radLat);
  magic = 1 - EE * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * PI);
  dLng = (dLng * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * PI);
  return { lat: wgsLat + dLat, lng: wgsLng + dLng };
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(y * PI) + 40.0 * Math.sin((y / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((160.0 * Math.sin((y / 12.0) * PI) + 320 * Math.sin((y * PI) / 30.0)) * 2.0) / 3.0;
  return ret;
}

function transformLng(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
  ret += ((20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0) / 3.0;
  ret += ((20.0 * Math.sin(x * PI) + 40.0 * Math.sin((x / 3.0) * PI)) * 2.0) / 3.0;
  ret += ((150.0 * Math.sin((x / 12.0) * PI) + 300.0 * Math.sin((x / 30.0) * PI)) * 2.0) / 3.0;
  return ret;
}
