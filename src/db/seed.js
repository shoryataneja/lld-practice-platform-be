const prisma = require('../prisma')
const { demoLearnerEmail } = require('../config')

const problems = [
  {
    slug: 'parking-lot',
    title: 'Parking Lot',
    difficulty: 'EASY',
    summary: 'Model a multi-level parking lot with spot types, entry/exit flows and parking rates.',
    description: [
      'Design a parking lot management system for a multi-level facility. Vehicles enter at a gate, are assigned an available spot, and pay for the duration they stay before exiting.',
      'Key requirements:',
      '- Support multiple spot types (motorcycle, compact, large) and enforce which vehicle fits where.',
      '- Track occupancy per level and per spot type, and refuse entry when the lot is full.',
      '- Compute fees based on parked duration and a per-spot-type hourly rate.',
      '- Handle the full lifecycle: entry, spot allocation, payment at exit, and spot release.',
      'There is no single correct answer. Focus on clean separation of concerns, sensible interfaces between gates/levels/spots, and explicit handling of the full-lot edge case.',
    ].join('\n'),
  },
  {
    slug: 'vending-machine',
    title: 'Vending Machine',
    difficulty: 'MEDIUM',
    summary: 'Design a vending machine that handles inventory, payments and dispensing.',
    description: [
      'Design a vending machine that sells a fixed catalog of products. A user inserts money, selects a product, and receives it only when enough value has been inserted and stock is available.',
      'Key requirements:',
      '- Maintain inventory per product and reflect stock after each purchase.',
      '- Accept mixed denominations and return correct change; cancel should refund the inserted balance.',
      '- Reject a selection when insufficient funds or the product is sold out.',
      '- Support a maintenance-only path to restock and collect cash, invisible to customers.',
      'Pay particular attention to money state transitions (idle -> inserting -> selecting -> dispensing -> change) and the sold-out and exact-change edge cases.',
    ].join('\n'),
  },
  {
    slug: 'elevator',
    title: 'Elevator',
    difficulty: 'MEDIUM',
    summary: 'Design an elevator control system coordinating requests across floors.',
    description: [
      'Design the control system for a set of elevators serving a multi-floor building. Passengers request a ride from a floor and select a destination from inside.',
      'Key requirements:',
      '- Model elevator state (idle, moving, doors open) and per-elevator direction.',
      '- Accept external calls per floor and internal destination requests, and schedule the nearest/elevator politely.',
      '- Handle door timing, overload, and requests that arrive while doors are closing.',
      '- Keep the scheduling logic decoupled from the hardware so the algorithm can be swapped or tested in isolation.',
      'A queue of pending floor/destination requests and clear state transitions are the core of this problem.',
    ].join('\n'),
  },
  {
    slug: 'library-management',
    title: 'Library Management',
    difficulty: 'MEDIUM',
    summary: 'Model books, members and borrowing workflows for a public library.',
    description: [
      'Design the backend model for a public library. Members browse titles, borrow copies, and return them; staff manage inventory and track overdue items.',
      'Key requirements:',
      '- Distinguish a title (book) from its physical copies, each with its own state (available, reserved, borrowed, lost).',
      '- Borrow/return workflows that respect copy availability and member borrowing limits.',
      '- Allow holding (reserving) copies that are currently borrowed, and notify/hold on return.',
      '- Charge fines for overdue copies and for lost items; block lending to members with unpaid fines.',
      'The distinction between title, copy, and loan, plus reservation queues, are the interesting parts of this design.',
    ].join('\n'),
  },
  {
    slug: 'movie-ticket-booking',
    title: 'Movie Ticket Booking',
    difficulty: 'HARD',
    summary: 'Design booking, seating selection and show management for a multiplex.',
    description: [
      'Design a booking system for a multiplex cinema. Users pick a show, select seats on a per-screen layout, and confirm a booking that locks the seats.',
      'Key requirements:',
      '- Model screens, shows (a movie at a screen/time), and seat layouts per show.',
      '- Support seat selection with atomic locking so two users never confirm the same seat.',
      '- Handle partial payment and expiry of held seats if the confirmation does not complete.',
      '- Enforce occupancy constraints (e.g. no single stranded seats) and premium pricing for select rows.',
      'Concurrency control on seat locking is the crux — choose a strategy that is simple, safe, and testable.',
    ].join('\n'),
  },
]

async function main() {
  const learner = await prisma.user.upsert({
    where: { email: demoLearnerEmail },
    update: {},
    create: { email: demoLearnerEmail, name: 'Demo Learner' },
  })
  console.log(`Learner ready: ${learner.email} (${learner.id})`)

  for (const problem of problems) {
    const saved = await prisma.problem.upsert({
      where: { slug: problem.slug },
      update: { ...problem, isPublished: true },
      create: { ...problem, isPublished: true },
    })
    console.log(`Problem upserted: ${saved.slug}`)
  }
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })