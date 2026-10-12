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
  "void-shaman": "/avatars/Fixed brand Icon.png",
  "cosmic-shadow": "/avatars/Genie Master.png",
  "faceless-weaver": "/avatars/Genie PRO.png",
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
  return (
    <img
      src={BRAND_ASSETS[variant]}
      alt={label}
      className={`${className} shrink-0 rounded-full object-cover`}
    />
  );
}
