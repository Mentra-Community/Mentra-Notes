/**
 * OnboardingPage - Multi-step onboarding flow
 *
 * Shows every time the app opens (logic not implemented yet).
 * Steps:
 * 1. Welcome - Introduction to Mentra Notes
 * 2. Tell us about you - Name, role, company, LinkedIn
 * 3. What matters most - Priority selection
 * 4. Who do you talk to most - Contacts & topics
 * 5-9. Tutorial walkthrough (5 pages: Always on, AI does the work, Stay organized, Swipe to manage, You're all set)
 */

import { useState, useCallback, useEffect } from "react";
import { useLocation } from "wouter";
import { AnimatePresence, motion } from "motion/react";
import {
  trackOnboardingStarted,
  trackOnboardingStepViewed,
  trackOnboardingCompleted,
  trackOnboardingSkipped,
} from "../../services/posthog";
import { WelcomeStep } from "./components/WelcomeStep";
import { AboutYouStep } from "./components/AboutYouStep";
import { PrioritiesStep } from "./components/PrioritiesStep";
import { ContactsStep } from "./components/ContactsStep";
import { TutorialAlwaysOn } from "./components/TutorialAlwaysOn";
import { TutorialAINotes } from "./components/TutorialAINotes";
import { TutorialOrganize } from "./components/TutorialOrganize";
import { TutorialSwipe } from "./components/TutorialSwipe";
import { TutorialComplete } from "./components/TutorialComplete";
import { OnboardingFooter } from "./components/OnboardingFooter";

const TOTAL_STEPS = 9;

const STEP_NAMES = [
  "welcome",
  "about_you",
  "priorities",
  "contacts",
  "tutorial_always_on",
  "tutorial_ai_notes",
  "tutorial_organize",
  "tutorial_swipe",
  "tutorial_complete",
];

export function OnboardingPage() {
  const [step, setStep] = useState(0);
  const [direction, setDirection] = useState(1);
  const [, navigate] = useLocation();

  // Track onboarding started on mount
  useEffect(() => {
    trackOnboardingStarted();
  }, []);

  // Track each step view
  useEffect(() => {
    trackOnboardingStepViewed(step, STEP_NAMES[step]);
  }, [step]);

  const next = useCallback(() => {
    if (step >= TOTAL_STEPS - 1) {
      trackOnboardingCompleted();
      navigate("/");
      return;
    }
    setDirection(1);
    setStep((s) => s + 1);
  }, [step, navigate]);

  const back = useCallback(() => {
    if (step <= 0) return;
    setDirection(-1);
    setStep((s) => s - 1);
  }, [step]);

  const finish = useCallback(() => {
    trackOnboardingSkipped(step);
    navigate("/");
  }, [navigate, step]);

  const variants = {
    enter: (dir: number) => ({
      x: dir > 0 ? 80 : -80,
      opacity: 0,
    }),
    center: {
      x: 0,
      opacity: 1,
    },
    exit: (dir: number) => ({
      x: dir > 0 ? -80 : 80,
      opacity: 0,
    }),
  };

  // Footer config per step: [dotIndex, totalDots, buttonLabel, showBack]
  const isWelcome = step === 0;
  const isLastStep = step === TOTAL_STEPS - 1;
  const dotIndex = step - 1; // step 1 → dot 0, step 8 → dot 7
  const totalDots = TOTAL_STEPS - 1; // 8 dots (exclude welcome)
  const buttonLabel = isLastStep ? "Done" : "Next";
  const onAction = isLastStep ? finish : next;

  const renderStep = () => {
    switch (step) {
      case 0:
        return <WelcomeStep onNext={next} />;
      case 1:
        return <AboutYouStep onNext={next} onBack={back} />;
      case 2:
        return <PrioritiesStep onNext={next} onBack={back} />;
      case 3:
        return <ContactsStep onNext={next} onBack={back} />;
      case 4:
        return <TutorialAlwaysOn onNext={next} onBack={back} />;
      case 5:
        return <TutorialAINotes onNext={next} onBack={back} />;
      case 6:
        return <TutorialOrganize onNext={next} onBack={back} />;
      case 7:
        return <TutorialSwipe onNext={next} onBack={back} />;
      case 8:
        return <TutorialComplete onFinish={finish} onBack={back} />;
      default:
        return null;
    }
  };

  return (
    <div className="h-full w-full bg-[#FAFAF9] dark:bg-black overflow-hidden relative flex flex-col">
      {/* Scrollable step content */}
      <div className="flex-1 min-h-0 overflow-x-hidden overflow-y-auto">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            className="h-full w-full"
          >
            {renderStep()}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Persistent footer — stays outside animation */}
      {!isWelcome && (
        <OnboardingFooter
          activeIndex={dotIndex}
          totalDots={totalDots}
          buttonLabel={buttonLabel}
          onAction={onAction}
          onBack={step > 0 ? back : undefined}
        />
      )}
    </div>
  );
}
