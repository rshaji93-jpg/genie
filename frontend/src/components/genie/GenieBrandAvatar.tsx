import { useState } from "react";

type GenieBrandAvatarProps = {
  gender?: string;
  className?: string;
  label?: string;
  mode?: "personal" | "workspace";
  corporatePhotoUrl?: string;
  corporateName?: string;
  tenantId?: string;
};

type BrandAvatarVariant = "void-shaman" | "cosmic-shadow" | "faceless-weaver";

const BRAND_ASSETS: Record<BrandAvatarVariant, string> = {
  "void-shaman": "/avatars/Fixed-brand-Icon.png",
  "cosmic-shadow": "/avatars/Genie-Master.png",
  "faceless-weaver": "/avatars/Genie-PRO.png",
};

export default function GenieBrandAvatar({
  className = "h-8 w-8",
  label = "Genie",
  mode = "personal",
  corporatePhotoUrl,
  corporateName = "",
  tenantId = "",
}: GenieBrandAvatarProps) {
  if (mode === "workspace") {
    if (corporatePhotoUrl) {
      return (
        <img
          src={corporatePhotoUrl}
          alt={corporateName ? `${corporateName} corporate profile` : label}
          className={`${className} shrink-0 rounded-full object-cover`}
        />
      );
    }
    const initials = corporateName
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() || "")
      .join("") || "WS";
    let colorHash = 0;
    for (const character of tenantId) colorHash = (colorHash * 31 + character.charCodeAt(0)) >>> 0;
    const tenantColor = `hsl(${colorHash % 360} 48% 38%)`;
    return (
      <span
        role="img"
        aria-label={corporateName ? `${corporateName} corporate profile` : "Corporate workspace profile"}
        className={`${className} inline-flex shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white`}
        style={{ backgroundColor: tenantColor }}
      >
        {initials}
      </span>
    );
  }
  return <BrandAvatar variant="void-shaman" className={className} label={label} />;
}

export function BrandAvatar({
  variant,
  className = "h-8 w-8",
  label = "Genie",
}: {
  variant: BrandAvatarVariant;
  className?: string;
  label?: string;
}) {
  const [failedImage, setFailedImage] = useState<{ variant: BrandAvatarVariant; failed: boolean }>({
    variant,
    failed: false,
  });
  const imageFailed = failedImage.variant === variant && failedImage.failed;
  if (imageFailed) {
    return (
      <svg
        role="img"
        aria-label={label}
        viewBox="0 0 40 40"
        className={`${className} shrink-0 rounded-full`}
      >
        <circle cx="20" cy="20" r="20" fill="#111827" />
        <path
          d="M20 7.5 23.7 16l8.8 1-6.5 6 1.8 8.7-7.8-4.5-7.8 4.5 1.8-8.7-6.5-6 8.8-1L20 7.5Z"
          fill="#67e8f9"
        />
      </svg>
    );
  }
  return (
    <img
      src={BRAND_ASSETS[variant]}
      alt={label}
      onError={() => setFailedImage({ variant, failed: true })}
      className={`${className} shrink-0 rounded-full object-cover`}
    />
  );
}
