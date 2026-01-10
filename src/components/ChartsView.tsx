'use client';

import React, { useState, useRef, useEffect } from 'react';
import { useIsMobile } from '@/hooks/useMediaQuery';

interface ChartCategory {
  id: string;
  title: string;
  charts: React.ReactNode[];
}

interface ChartsViewProps {
  categories: ChartCategory[];
}

export function ChartsView({ categories }: ChartsViewProps) {
  const [activeCategory, setActiveCategory] = useState(0);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const [touchEnd, setTouchEnd] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  // Minimum swipe distance (in px)
  const minSwipeDistance = 50;

  const onTouchStart = (e: React.TouchEvent) => {
    setTouchEnd(null);
    setTouchStart(e.targetTouches[0].clientX);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    setTouchEnd(e.targetTouches[0].clientX);
  };

  const onTouchEnd = () => {
    if (!touchStart || !touchEnd) return;

    const distance = touchStart - touchEnd;
    const isLeftSwipe = distance > minSwipeDistance;
    const isRightSwipe = distance < -minSwipeDistance;

    if (isLeftSwipe && activeCategory < categories.length - 1) {
      setActiveCategory(activeCategory + 1);
    } else if (isRightSwipe && activeCategory > 0) {
      setActiveCategory(activeCategory - 1);
    }
  };

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.style.transform = `translateX(-${activeCategory * 100}%)`;
    }
  }, [activeCategory]);

  if (!isMobile) {
    // Desktop view: show all charts in grid
    return (
      <div className="dashboard-grid">
        {categories.flatMap(category => category.charts)}
      </div>
    );
  }

  // Mobile view: swipeable categories
  return (
    <div className="charts-mobile-view">
      {/* Category tabs */}
      <div className="chart-categories">
        {categories.map((category, index) => (
          <button
            key={category.id}
            className={`chart-category-tab ${index === activeCategory ? 'active' : ''}`}
            onClick={() => setActiveCategory(index)}
          >
            {category.title}
          </button>
        ))}
      </div>

      {/* Swipeable chart container */}
      <div
        className="chart-swiper"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          ref={containerRef}
          className="chart-swiper-container"
          style={{
            width: `${categories.length * 100}%`,
            transition: 'transform 0.3s ease',
          }}
        >
          {categories.map((category) => (
            <div
              key={category.id}
              className="chart-swiper-slide"
              style={{ width: `${100 / categories.length}%` }}
            >
              <div className="chart-mobile-grid">
                {category.charts}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Swipe indicators */}
      <div className="chart-indicators">
        {categories.map((_, index) => (
          <div
            key={index}
            className={`chart-indicator ${index === activeCategory ? 'active' : ''}`}
          />
        ))}
      </div>
    </div>
  );
}
