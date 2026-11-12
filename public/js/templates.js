/* Starter diagrams shown on the dashboard and in the no-account demo. */
window.UNTANGLE_TEMPLATES=[
  {id:"flow",title:"Checkout flow",kind:"Flowchart",desc:"A 21-step food delivery checkout with decisions and notes. Try Walkthrough.",source:`flowchart TD
    start([Customer opens app]) --> browse[Browse restaurants]
    browse --> cart[Add items to cart]
    cart --> login{Logged in?}
    login -->|No| signin[Sign in with OTP]
    login -->|Yes| addr{Saved address?}
    signin --> addr
    addr -->|No| newaddr[Add delivery address]
    addr -->|Yes| pay[Choose payment]
    newaddr --> pay
    pay --> method{Payment method}
    method -->|UPI| upi[Pay with UPI app]
    method -->|Card| card[Enter card details]
    method -->|Cash| cod[Cash on delivery]
    upi --> ok{Payment went through?}
    card --> ok
    ok -->|No| retry[Show error]
    retry -.-> pay
    ok -->|Yes| placed[Order placed]
    cod --> placed
    placed --> accept{Restaurant accepts?}
    accept -->|No| refund[Cancel and refund]
    accept -->|Yes| driver[Assign driver]
    driver --> track[Live tracking]
    track --> done([Delivered])
    refund --> cancelled([Order cancelled])
%% note: signin A 6-digit code is sent by SMS. After 3 wrong tries the customer waits 30 seconds.
%% note: ok The payment provider confirms by webhook. If nothing arrives in 2 minutes, treat it as failed.
%% note: accept The restaurant has 90 seconds to accept before the order is cancelled automatically.
%% note: refund UPI and card refunds go back to the original method within 5-7 working days.
%% note: driver Pick the nearest free driver within 3 km; widen the search every 30 seconds.`},
  {id:"er",title:"Food delivery data model",kind:"ER diagram",desc:"10 tables with keys and relationships for a delivery service.",source:`erDiagram
    CUSTOMER ||--o{ ORDER : places
    RESTAURANT ||--|{ MENU_ITEM : offers
    ORDER ||--|{ ORDER_ITEM : contains
    MENU_ITEM ||--o{ ORDER_ITEM : "ordered as"
    RESTAURANT ||--o{ ORDER : receives
    ORDER ||--|| PAYMENT : "paid by"
    ORDER ||--o| DELIVERY : "fulfilled by"
    DRIVER ||--o{ DELIVERY : makes
    CUSTOMER ||--o{ ADDRESS : saves
    ADDRESS ||--o{ DELIVERY : "delivered to"
    CUSTOMER ||--o{ REVIEW : writes
    RESTAURANT ||--o{ REVIEW : gets
    CUSTOMER {
        uuid id PK
        string name
        string email UK
        string phone
        timestamp created_at
    }
    ADDRESS {
        uuid id PK
        uuid customer_id FK
        string line1
        string city
        string pincode
    }
    RESTAURANT {
        uuid id PK
        string name
        string cuisine
        float rating
        boolean is_open
    }
    MENU_ITEM {
        uuid id PK
        uuid restaurant_id FK
        string name
        int price_paise
        boolean available
    }
    ORDER {
        uuid id PK
        uuid customer_id FK
        uuid restaurant_id FK
        string status
        int total_paise
        timestamp placed_at
    }
    ORDER_ITEM {
        uuid order_id PK, FK
        uuid menu_item_id PK, FK
        int quantity
        int unit_price_paise
    }
    PAYMENT {
        uuid id PK
        uuid order_id FK, UK
        string method
        string status
        int amount_paise
    }
    DRIVER {
        uuid id PK
        string name
        string phone UK
        string vehicle_no
    }
    DELIVERY {
        uuid id PK
        uuid order_id FK, UK
        uuid driver_id FK
        uuid address_id FK
        timestamp picked_up_at
        timestamp delivered_at
    }
    REVIEW {
        uuid id PK
        uuid customer_id FK
        uuid restaurant_id FK
        int stars
        string comment
    }
%% note: ORDER status is one of placed, accepted, picked_up, delivered or cancelled.
%% note: PAYMENT Amounts are stored in paise (1/100 rupee) so totals never have rounding errors.
%% note: ORDER_ITEM unit_price_paise copies the menu price at order time, so later price changes don't rewrite old orders.`},
  {id:"seq",title:"Payment sequence",kind:"Sequence diagram",desc:"How an order and a UPI payment move between the app, gateway and restaurant.",source:`sequenceDiagram
    autonumber
    actor C as Customer
    participant A as App
    participant P as Payment gateway
    participant R as Restaurant
    C->>A: Place order
    A->>P: Create payment
    P-->>C: Ask to approve in UPI app
    C->>P: Approve
    P-->>A: Payment confirmed (webhook)
    A->>R: Send order
    R-->>A: Accepted
    A-->>C: Order confirmed`},
  {id:"class",title:"Ordering classes",kind:"Class diagram",desc:"Orders, payments and customers with inheritance, composition and a namespace.",source:"classDiagram\n    class Order {\n        +String id\n        +int totalPaise\n        +place() bool\n        +cancel(reason) void\n    }\n    class Payment {\n        <<abstract>>\n        +int amountPaise\n        +capture() bool\n    }\n    class UpiPayment {\n        +String vpa\n    }\n    class CardPayment {\n        +String last4\n    }\n    class Customer {\n        +String name\n        +String phone\n    }\n    class OrderItem {\n        +int quantity\n    }\n    namespace Billing {\n        class Invoice\n    }\n    Customer \"1\" --> \"*\" Order : places\n    Order \"1\" *-- \"1..*\" OrderItem : contains\n    Order --> Payment : paid by\n    Payment <|-- UpiPayment\n    Payment <|-- CardPayment\n    Order ..> Invoice : creates\n    note for Payment \"Amounts are in paise\""},
  {id:"state",title:"Order lifecycle",kind:"State diagram",desc:"An order from placed to delivered, with a composite payment state and a choice.",source:"stateDiagram-v2\n    [*] --> Placed\n    state Placed {\n        [*] --> Paying\n        Paying --> Paid : payment ok\n        Paying --> Failed : payment failed\n        Failed --> Paying : retry\n    }\n    Placed --> Preparing : restaurant accepts\n    Preparing : Kitchen is cooking\n    state driver <<choice>>\n    Preparing --> driver\n    driver --> OutForDelivery : driver found\n    driver --> Cancelled : no driver\n    OutForDelivery --> Delivered\n    Delivered --> [*]\n    Cancelled --> [*]"},
  {id:"gantt",title:"Launch plan",kind:"Gantt chart",desc:"Tasks, sections and a milestone. Edit tasks in a table.",source:"gantt\n    title Launch plan\n    dateFormat YYYY-MM-DD\n    section Build\n    Editor polish        :done,    a1, 2026-11-02, 7d\n    Sharing and history  :active,  a2, after a1, 5d\n    section Launch\n    Beta invites         :         b1, after a2, 4d\n    Public launch        :milestone, b2, after b1, 0d"},
  {id:"mindmap",title:"Product mindmap",kind:"Mindmap",desc:"Ideas in a tree. Indent and outdent lines to reshape it.",source:"mindmap\n  root((Untangle))\n    Editing\n      Drag and drop\n      Inline text\n      Walkthrough\n    Diagram types\n      Flowchart\n      Sequence\n      Class\n      State\n    Sharing\n      Links\n      Export"},
  {id:"timeline",title:"Roadmap timeline",kind:"Timeline",desc:"Periods and events, edited in a table.",source:"timeline\n    title Roadmap\n    Q4 2026 : Editor beta : Share links\n    Q1 2027 : Teams : Comments\n    Q2 2027 : Embeds for Notion and GitHub"},
  {id:"journey",title:"Ordering journey",kind:"User journey",desc:"How a customer feels at each step, scored 1 to 5.",source:"journey\n    title Ordering dinner\n    section Choose\n      Browse restaurants: 4: Customer\n      Pick dishes: 5: Customer\n    section Pay\n      Enter OTP: 2: Customer\n      Pay with UPI: 4: Customer\n    section Wait\n      Track driver: 3: Customer\n      Food arrives: 5: Customer, Driver"},
  {id:"pie",title:"Orders by payment method",kind:"Pie chart \u00b7 view only",desc:"A sample pie chart, drawn by Mermaid.",source:`pie title Orders by payment method (sample numbers)
    "UPI" : 62
    "Card" : 23
    "Cash on delivery" : 15`},
  {id:"blank-flow",title:"Blank flowchart",kind:"Flowchart",desc:"Start from two boxes.",source:"flowchart TD\n    a([Start]) --> b[First step]"},
  {id:"blank-er",title:"Blank ER diagram",kind:"ER diagram",desc:"Start from one table.",source:"erDiagram\n    NEW_TABLE {\n        uuid id PK\n    }"},
  {id:"blank-seq",title:"Blank sequence diagram",kind:"Sequence diagram",desc:"Start from two participants.",source:"sequenceDiagram\n    actor U as User\n    participant S as System\n    U->>S: Request\n    S-->>U: Response"}
];
