import { useTheme } from '../theme';

interface BrandProps {
  light?: boolean;
  decorative?: boolean;
  mark?: boolean;
}

export function Brand({ light, decorative = false, mark = false }: BrandProps) {
  const { resolved } = useTheme();
  const lightLogo = light ?? resolved === 'dark';
  return (
    <img
      className={`brand-logo${mark ? ' brand-mark' : ''}`}
      src={
        mark
          ? lightLogo
            ? '/brand/kasa-mark-mint.svg'
            : '/brand/kasa-mark.svg'
          : lightLogo
            ? '/brand/kasa-logo-light.svg'
            : '/brand/kasa-logo.svg'
      }
      alt={decorative ? '' : 'Kasa'}
      width={mark ? 60 : 192}
      height={60}
      draggable={false}
    />
  );
}
