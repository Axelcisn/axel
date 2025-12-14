'use client';

import { ReactNode } from 'react';

type LayoutContainerProps = {
  children: ReactNode;
  className?: string;
};

const baseClass = 'mx-auto w-full max-w-[1400px] px-6 md:px-10';

export default function LayoutContainer({ children, className }: LayoutContainerProps) {
  const composed = className ? `${baseClass} ${className}` : baseClass;
  return <div className={composed}>{children}</div>;
}
