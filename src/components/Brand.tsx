interface BrandProps {
  light?: boolean;
  decorative?: boolean;
}

export function Brand({ light = false, decorative = false }: BrandProps) {
  return (
    <img
      className="brand-logo"
      src={light ? '/brand/kasa-logo-light.svg' : '/brand/kasa-logo.svg'}
      alt={decorative ? '' : 'Kasa'}
      width={192}
      height={60}
      draggable={false}
    />
  );
}
