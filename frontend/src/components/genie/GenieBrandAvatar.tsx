type GenieBrandAvatarProps = {
  gender?: string;
  className?: string;
  label?: string;
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
}: GenieBrandAvatarProps) {
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
