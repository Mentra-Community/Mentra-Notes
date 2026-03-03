interface DotsSpinnerProps {
  size?: number;
  className?: string;
}

export function DotsSpinner({ size = 24, className }: DotsSpinnerProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={className}
    >
      <g fill="currentColor">
        <circle cx="12" cy="3" r="1">
          <animate id="d1" attributeName="r" begin="0;d12.end-0.5s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="16.5" cy="4.21" r="1">
          <animate id="d2" attributeName="r" begin="d1.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="7.5" cy="4.21" r="1">
          <animate id="d12" attributeName="r" begin="d11.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="19.79" cy="7.5" r="1">
          <animate id="d3" attributeName="r" begin="d2.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="4.21" cy="7.5" r="1">
          <animate id="d11" attributeName="r" begin="d10.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="21" cy="12" r="1">
          <animate id="d4" attributeName="r" begin="d3.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="3" cy="12" r="1">
          <animate id="d10" attributeName="r" begin="d9.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="19.79" cy="16.5" r="1">
          <animate id="d5" attributeName="r" begin="d4.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="4.21" cy="16.5" r="1">
          <animate id="d9" attributeName="r" begin="d8.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="16.5" cy="19.79" r="1">
          <animate id="d6" attributeName="r" begin="d5.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="7.5" cy="19.79" r="1">
          <animate id="d8" attributeName="r" begin="d7.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <circle cx="12" cy="21" r="1">
          <animate id="d7" attributeName="r" begin="d6.begin+0.1s" calcMode="spline" dur="0.6s" keySplines=".27,.42,.37,.99;.53,0,.61,.73" values="1;2;1" />
        </circle>
        <animateTransform attributeName="transform" dur="6s" repeatCount="indefinite" type="rotate" values="360 12 12;0 12 12" />
      </g>
    </svg>
  );
}
